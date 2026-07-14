package gitexec

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Clone clones a GitHub HTTPS repository into dest (must not exist).
func (e *Executor) Clone(ctx context.Context, rawURL, dest string, auth AuthEnv) error {
	ref, err := ParseGitHubHTTPSURL(rawURL)
	if err != nil {
		return err
	}
	dest = filepath.Clean(dest)
	if dest == "" || dest == "." {
		return fmt.Errorf("目标路径无效")
	}
	if st, err := os.Stat(dest); err == nil {
		if st.IsDir() {
			entries, _ := os.ReadDir(dest)
			if len(entries) > 0 {
				return fmt.Errorf("目标文件夹已存在且非空")
			}
		} else {
			return fmt.Errorf("目标路径已存在")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	parent := filepath.Dir(dest)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return fmt.Errorf("无法创建父目录：%w", err)
	}
	res, err := e.Run(ctx, RunOpts{
		Args:     []string{"clone", "--", ref.URL, dest},
		Write:    true,
		Repo:     parent, // serialize by parent path
		Timeout:  10 * time.Minute,
		ExtraEnv: auth.env(),
	})
	if err != nil {
		return mapRemoteGitError(string(res.Stderr), err, isTimeout(err))
	}
	return nil
}

// HasLFSConfig is a best-effort warning helper (does not require git-lfs binary).
func (e *Executor) HasLFSPointers(ctx context.Context, repo string) bool {
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"grep", "-l", "git-lfs", "--", ".gitattributes"},
		Timeout: 10 * time.Second,
	})
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(res.Stdout)) != ""
}
