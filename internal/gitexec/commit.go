package gitexec

import (
	"bytes"
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

type CommitRequest struct {
	Paths       []string
	Message     string
	AuthorName  string
	AuthorEmail string
	Fingerprint string
}

type CommitResult struct {
	SHA     string `json:"sha"`
	Short   string `json:"short"`
	Message string `json:"message"`
}

func (e *Executor) Commit(ctx context.Context, repo string, req CommitRequest) (CommitResult, error) {
	if strings.TrimSpace(req.Message) == "" {
		return CommitResult{}, fmt.Errorf("版本说明不能为空")
	}
	if len(req.Paths) == 0 {
		return CommitResult{}, fmt.Errorf("请至少选择一个文件")
	}
	health, err := e.Health(ctx, repo)
	if err != nil {
		return CommitResult{}, err
	}
	if !health.OK {
		return CommitResult{}, fmt.Errorf("无法保存版本：%s", strings.Join(health.Blockers, "；"))
	}
	snap, err := e.Status(ctx, repo)
	if err != nil {
		return CommitResult{}, err
	}
	if req.Fingerprint != "" && req.Fingerprint != snap.Fingerprint {
		return CommitResult{}, fmt.Errorf("文件在确认期间发生了变化，请复核后再保存")
	}
	for _, p := range req.Paths {
		if err := assertInsideRepo(repo, p); err != nil {
			return CommitResult{}, err
		}
	}

	// Stage selected paths with NUL pathspec.
	pathspec := pathsToNUL(req.Paths)
	_, err = e.Run(ctx, RunOpts{
		Repo:    repo,
		Write:   true,
		Args:    []string{"add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"},
		Stdin:   pathspec,
		Timeout: 60 * time.Second,
	})
	if err != nil {
		return CommitResult{}, fmt.Errorf("暂存失败：%w", err)
	}

	env := []string{
		"GIT_AUTHOR_NAME=" + req.AuthorName,
		"GIT_AUTHOR_EMAIL=" + req.AuthorEmail,
		"GIT_COMMITTER_NAME=" + req.AuthorName,
		"GIT_COMMITTER_EMAIL=" + req.AuthorEmail,
	}
	// commit --only with pathspec so other staged files are not included.
	_, err = e.Run(ctx, RunOpts{
		Repo:     repo,
		Write:    true,
		Args:     []string{"commit", "--only", "--pathspec-from-file=-", "--pathspec-file-nul", "-m", req.Message},
		Stdin:    pathspec,
		Timeout:  120 * time.Second,
		ExtraEnv: env,
	})
	if err != nil {
		return CommitResult{}, fmt.Errorf("保存版本失败：%w", err)
	}
	shaRes, err := e.Run(ctx, RunOpts{Repo: repo, Args: []string{"rev-parse", "HEAD"}, Timeout: 10 * time.Second})
	if err != nil {
		return CommitResult{}, err
	}
	sha := strings.TrimSpace(string(shaRes.Stdout))
	short := sha
	if len(short) > 7 {
		short = short[:7]
	}
	return CommitResult{SHA: sha, Short: short, Message: req.Message}, nil
}

func pathsToNUL(paths []string) []byte {
	var b bytes.Buffer
	for _, p := range paths {
		b.WriteString(filepath.ToSlash(p))
		b.WriteByte(0)
	}
	return b.Bytes()
}

func (e *Executor) InitRepo(ctx context.Context, path string) error {
	_, err := e.Run(ctx, RunOpts{
		Args:    []string{"init", "-b", "main", "--", path},
		Write:   true,
		Timeout: 30 * time.Second,
	})
	return err
}

func (e *Executor) IsRepo(ctx context.Context, path string) (bool, error) {
	res, err := e.Run(ctx, RunOpts{
		Repo:    path,
		Args:    []string{"rev-parse", "--is-inside-work-tree"},
		Timeout: 10 * time.Second,
	})
	if err != nil {
		return false, nil
	}
	return strings.TrimSpace(string(res.Stdout)) == "true", nil
}
