package gitexec

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type CommitSummary struct {
	SHA     string `json:"sha"`
	Short   string `json:"short"`
	Subject string `json:"subject"`
	Body    string `json:"body,omitempty"`
	Author  string `json:"author"`
	Email   string `json:"email"`
	Date    string `json:"date"`
}

type CommitFile struct {
	Path      string `json:"path"`
	OldPath   string `json:"oldPath,omitempty"`
	Status    string `json:"status"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

type HistoryPage struct {
	Commits []CommitSummary `json:"commits"`
	Cursor  string          `json:"cursor,omitempty"`
}

func (e *Executor) Log(ctx context.Context, repo string, limit int, cursor string, pathFilter string) (HistoryPage, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []string{
		"log",
		"--format=%H%x00%h%x00%s%x00%b%x00%an%x00%ae%x00%aI%x00",
		"-z",
		"-n", strconv.Itoa(limit),
	}
	if cursor != "" {
		args = append(args, cursor+"^")
	}
	if pathFilter != "" {
		args = append(args, "--", pathFilter)
	}
	res, err := e.Run(ctx, RunOpts{Repo: repo, Args: args, Timeout: 30 * time.Second})
	if err != nil {
		// empty repo
		if !strings.Contains(err.Error(), "bad revision") && !strings.Contains(string(res.Stderr), "does not have any commits") {
			// still try
		}
		return HistoryPage{Commits: []CommitSummary{}}, nil
	}
	commits := parseLog(res.Stdout)
	page := HistoryPage{Commits: commits}
	if len(commits) == limit {
		page.Cursor = commits[len(commits)-1].SHA
	}
	return page, nil
}

func parseLog(data []byte) []CommitSummary {
	parts := strings.Split(string(data), "\x00")
	var out []CommitSummary
	// records are H h s b an ae aI then empty due to trailing
	i := 0
	for i+6 < len(parts) {
		sha := parts[i]
		if sha == "" || sha == "\n" {
			i++
			continue
		}
		// skip leading newlines in sha
		sha = strings.TrimLeft(sha, "\n")
		if sha == "" {
			i++
			continue
		}
		c := CommitSummary{
			SHA:     sha,
			Short:   parts[i+1],
			Subject: parts[i+2],
			Body:    strings.TrimSpace(parts[i+3]),
			Author:  parts[i+4],
			Email:   parts[i+5],
			Date:    parts[i+6],
		}
		out = append(out, c)
		i += 7
	}
	return out
}

func (e *Executor) CommitDetail(ctx context.Context, repo, sha string) (CommitSummary, []CommitFile, error) {
	res, err := e.Run(ctx, RunOpts{
		Repo: repo,
		Args: []string{"show", "-s", "--format=%H%x00%h%x00%s%x00%b%x00%an%x00%ae%x00%aI%x00", sha},
		Timeout: 15 * time.Second,
	})
	if err != nil {
		return CommitSummary{}, nil, err
	}
	commits := parseLog(res.Stdout)
	if len(commits) == 0 {
		return CommitSummary{}, nil, fmt.Errorf("提交不存在")
	}
	num, err := e.Run(ctx, RunOpts{
		Repo: repo,
		Args: []string{"show", "--numstat", "--format=", "--name-status", sha},
		Timeout: 30 * time.Second,
	})
	if err != nil {
		return commits[0], nil, err
	}
	files := parseNameStatusNumstat(num.Stdout)
	return commits[0], files, nil
}

func parseNameStatusNumstat(data []byte) []CommitFile {
	lines := strings.Split(string(data), "\n")
	statusMap := map[string]CommitFile{}
	order := []string{}
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		// name-status: M path / R100 old new
		if len(fields[0]) <= 2 || strings.HasPrefix(fields[0], "R") || strings.HasPrefix(fields[0], "C") ||
			fields[0] == "A" || fields[0] == "D" || fields[0] == "M" || fields[0] == "T" {
			st := fields[0]
			if strings.HasPrefix(st, "R") || strings.HasPrefix(st, "C") {
				if len(fields) >= 3 {
					cf := CommitFile{Status: st[:1], OldPath: fields[1], Path: fields[2]}
					statusMap[cf.Path] = cf
					order = append(order, cf.Path)
				}
			} else {
				cf := CommitFile{Status: st, Path: fields[1]}
				statusMap[cf.Path] = cf
				order = append(order, cf.Path)
			}
			continue
		}
		// numstat: add del path
		if len(fields) >= 3 {
			add, _ := strconv.Atoi(fields[0])
			del, _ := strconv.Atoi(fields[1])
			path := fields[2]
			if strings.Contains(path, "=>") {
				// rename in numstat with braces - keep simple
			}
			cf := statusMap[path]
			cf.Path = path
			cf.Additions = add
			cf.Deletions = del
			if cf.Status == "" {
				cf.Status = "M"
				order = append(order, path)
			}
			statusMap[path] = cf
		}
	}
	out := make([]CommitFile, 0, len(order))
	seen := map[string]bool{}
	for _, p := range order {
		if seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, statusMap[p])
	}
	return out
}

func (e *Executor) DiffCommitFile(ctx context.Context, repo, sha, path string) (DiffResult, error) {
	if err := assertInsideRepo(repo, path); err != nil {
		return DiffResult{}, err
	}
	res, err := e.Run(ctx, RunOpts{
		Repo: repo,
		Args: []string{"show", "--format=", "--unified=3", sha, "--", path},
		Timeout: 30 * time.Second,
	})
	if err != nil {
		return DiffResult{}, err
	}
	patch := string(res.Stdout)
	out := DiffResult{Path: path, Kind: DiffText, Patch: patch}
	out.Additions, out.Deletions = countDiffStats(patch)
	return out, nil
}
