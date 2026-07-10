package gitexec

import (
	"bytes"
	"context"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type FileStatusKind string

const (
	StatusUntracked  FileStatusKind = "untracked"
	StatusModified   FileStatusKind = "modified"
	StatusAdded      FileStatusKind = "added"
	StatusDeleted    FileStatusKind = "deleted"
	StatusRenamed    FileStatusKind = "renamed"
	StatusCopied     FileStatusKind = "copied"
	StatusConflicted FileStatusKind = "conflicted"
	StatusTypeChange FileStatusKind = "typechange"
)

type FileStatus struct {
	Path     string         `json:"path"`
	OldPath  string         `json:"oldPath,omitempty"`
	Kind     FileStatusKind `json:"kind"`
	Staged   bool           `json:"staged"`
	Unstaged bool           `json:"unstaged"`
}

type RepoHealth struct {
	OK              bool     `json:"ok"`
	HasHead         bool     `json:"hasHead"`
	Branch          string   `json:"branch"`
	Detached        bool     `json:"detached"`
	Bare            bool     `json:"bare"`
	MergeInProgress bool     `json:"mergeInProgress"`
	RebaseInProgress bool    `json:"rebaseInProgress"`
	CherryPick      bool     `json:"cherryPick"`
	Revert          bool     `json:"revert"`
	IndexLocked     bool     `json:"indexLocked"`
	Blockers        []string `json:"blockers"`
}

type StatusSnapshot struct {
	Health    RepoHealth   `json:"health"`
	Files     []FileStatus `json:"files"`
	Fingerprint string     `json:"fingerprint"`
}

func (e *Executor) Status(ctx context.Context, repo string) (StatusSnapshot, error) {
	health, err := e.Health(ctx, repo)
	if err != nil {
		return StatusSnapshot{}, err
	}
	res, err := e.Run(ctx, RunOpts{
		Repo: repo,
		Args: []string{"status", "--porcelain=v2", "-z", "--untracked-files=all", "--branch"},
		Timeout: 30 * time.Second,
	})
	if err != nil {
		return StatusSnapshot{Health: health}, err
	}
	files := parsePorcelainV2(res.Stdout)
	fp := fingerprint(files)
	return StatusSnapshot{Health: health, Files: files, Fingerprint: fp}, nil
}

func (e *Executor) Health(ctx context.Context, repo string) (RepoHealth, error) {
	h := RepoHealth{OK: true}
	// Is this a git repo?
	res, err := e.Run(ctx, RunOpts{Repo: repo, Args: []string{"rev-parse", "--is-inside-work-tree"}, Timeout: 10 * time.Second})
	if err != nil || strings.TrimSpace(string(res.Stdout)) != "true" {
		h.OK = false
		h.Blockers = append(h.Blockers, "不是有效的 Git 工作区")
		return h, nil
	}
	bare, _ := e.Run(ctx, RunOpts{Repo: repo, Args: []string{"rev-parse", "--is-bare-repository"}, Timeout: 5 * time.Second})
	h.Bare = strings.TrimSpace(string(bare.Stdout)) == "true"
	if h.Bare {
		h.OK = false
		h.Blockers = append(h.Blockers, "不支持 bare 仓库")
	}
	head, err := e.Run(ctx, RunOpts{Repo: repo, Args: []string{"rev-parse", "--verify", "HEAD"}, Timeout: 5 * time.Second})
	h.HasHead = err == nil && len(bytes.TrimSpace(head.Stdout)) > 0

	sym, _ := e.Run(ctx, RunOpts{Repo: repo, Args: []string{"symbolic-ref", "-q", "--short", "HEAD"}, Timeout: 5 * time.Second})
	if err == nil && len(bytes.TrimSpace(sym.Stdout)) > 0 {
		h.Branch = strings.TrimSpace(string(sym.Stdout))
	} else if h.HasHead {
		h.Detached = true
		h.Branch = "detached HEAD"
		h.Blockers = append(h.Blockers, "当前处于 detached HEAD，已暂停保存版本")
		h.OK = false
	} else {
		h.Branch = "main"
	}

	gitDirRes, _ := e.Run(ctx, RunOpts{Repo: repo, Args: []string{"rev-parse", "--git-dir"}, Timeout: 5 * time.Second})
	gitDir := strings.TrimSpace(string(gitDirRes.Stdout))
	if gitDir != "" && !filepath.IsAbs(gitDir) {
		gitDir = filepath.Join(repo, gitDir)
	}
	if gitDir != "" {
		if fileExists(filepath.Join(gitDir, "MERGE_HEAD")) {
			h.MergeInProgress = true
			h.OK = false
			h.Blockers = append(h.Blockers, "存在未完成的合并")
		}
		if fileExists(filepath.Join(gitDir, "rebase-merge")) || fileExists(filepath.Join(gitDir, "rebase-apply")) {
			h.RebaseInProgress = true
			h.OK = false
			h.Blockers = append(h.Blockers, "存在未完成的 rebase")
		}
		if fileExists(filepath.Join(gitDir, "CHERRY_PICK_HEAD")) {
			h.CherryPick = true
			h.OK = false
			h.Blockers = append(h.Blockers, "存在未完成的 cherry-pick")
		}
		if fileExists(filepath.Join(gitDir, "REVERT_HEAD")) {
			h.Revert = true
			h.OK = false
			h.Blockers = append(h.Blockers, "存在未完成的 revert")
		}
		if fileExists(filepath.Join(gitDir, "index.lock")) {
			h.IndexLocked = true
			h.OK = false
			h.Blockers = append(h.Blockers, "index.lock 存在，可能有其他 Git 进程正在运行")
		}
	}
	return h, nil
}

func fileExists(p string) bool {
	_, err := osStatImpl(p)
	return err == nil
}

func parsePorcelainV2(data []byte) []FileStatus {
	parts := bytes.Split(data, []byte{0})
	var out []FileStatus
	for _, p := range parts {
		if len(p) == 0 {
			continue
		}
		line := string(p)
		if strings.HasPrefix(line, "#") {
			continue
		}
		fs, ok := parsePorcelainEntry(line)
		if ok {
			out = append(out, fs)
		}
	}
	return out
}

func parsePorcelainEntry(line string) (FileStatus, bool) {
	if len(line) < 2 {
		return FileStatus{}, false
	}
	switch line[0] {
	case '1':
		// ordinary: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
		fields := strings.SplitN(line, " ", 9)
		if len(fields) < 9 {
			return FileStatus{}, false
		}
		xy := fields[1]
		path := fields[8]
		return ordinaryStatus(xy, path, ""), true
	case '2':
		// rename/copy: 2 <XY> ... <score> <path>\t<orig>
		// With -z, path and orig are separated by NUL which we already split;
		// porcelain v2 with -z for renames: the entry contains path\0origPath as separate?
		// Actually for -z, rename is: ... <path>\0<origPath>\0 as one record with tab? 
		// From git docs: when -z, pathnames separated by NUL.
		// Our split already broke them. Handle tab form without -z path pairing carefully.
		fields := strings.SplitN(line, " ", 10)
		if len(fields) < 10 {
			return FileStatus{}, false
		}
		xy := fields[1]
		rest := fields[9]
		path, old := rest, ""
		if i := strings.IndexByte(rest, '\t'); i >= 0 {
			path = rest[:i]
			old = rest[i+1:]
		}
		kind := StatusRenamed
		if strings.Contains(fields[0], "") && len(fields) > 0 {
			// score field includes R/C
		}
		if len(fields) >= 9 {
			score := fields[8]
			if strings.HasPrefix(score, "C") {
				kind = StatusCopied
			}
		}
		fs := ordinaryStatus(xy, path, old)
		fs.Kind = kind
		fs.OldPath = old
		return fs, true
	case 'u':
		// unmerged
		fields := strings.SplitN(line, " ", 11)
		if len(fields) < 11 {
			return FileStatus{}, false
		}
		return FileStatus{Path: fields[10], Kind: StatusConflicted, Unstaged: true}, true
	case '?':
		path := strings.TrimPrefix(line, "? ")
		return FileStatus{Path: path, Kind: StatusUntracked, Unstaged: true}, true
	case '!':
		return FileStatus{}, false
	default:
		return FileStatus{}, false
	}
}

func ordinaryStatus(xy, path, old string) FileStatus {
	fs := FileStatus{Path: path, OldPath: old}
	x, y := xy[0], xy[1]
	if x != '.' {
		fs.Staged = true
	}
	if y != '.' {
		fs.Unstaged = true
	}
	switch {
	case x == 'A' || y == 'A':
		fs.Kind = StatusAdded
	case x == 'D' || y == 'D':
		fs.Kind = StatusDeleted
	case x == 'R' || y == 'R':
		fs.Kind = StatusRenamed
	case x == 'C' || y == 'C':
		fs.Kind = StatusCopied
	case x == 'T' || y == 'T':
		fs.Kind = StatusTypeChange
	default:
		fs.Kind = StatusModified
	}
	return fs
}

func fingerprint(files []FileStatus) string {
	var b strings.Builder
	for _, f := range files {
		fmt.Fprintf(&b, "%s|%s|%v|%v\n", f.Path, f.Kind, f.Staged, f.Unstaged)
	}
	return strconv.Itoa(len(files)) + ":" + fmt.Sprintf("%x", hashString(b.String()))
}

func hashString(s string) uint32 {
	var h uint32 = 2166136261
	for i := 0; i < len(s); i++ {
		h ^= uint32(s[i])
		h *= 16777619
	}
	return h
}
