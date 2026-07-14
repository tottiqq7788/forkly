package gitexec

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ErrNotWorktree indicates absPath is not inside a Git working tree.
var ErrNotWorktree = errors.New("not a git worktree")

// WorktreeFile is a file located inside a Git working tree.
type WorktreeFile struct {
	// Root is the absolute, symlink-resolved worktree root (--show-toplevel).
	Root string
	// Rel is the path relative to Root using forward slashes (repo-relative).
	Rel string
}

// ResolveWorktreeFile finds the nearest Git worktree that contains absPath.
// Nested repositories resolve to the innermost worktree that owns the file.
func (e *Executor) ResolveWorktreeFile(ctx context.Context, absPath string) (WorktreeFile, error) {
	absPath = strings.TrimSpace(absPath)
	if absPath == "" {
		return WorktreeFile{}, fmt.Errorf("%w: empty path", ErrNotWorktree)
	}
	absPath, err := filepath.Abs(absPath)
	if err != nil {
		return WorktreeFile{}, err
	}
	resolved, err := filepath.EvalSymlinks(absPath)
	if err != nil {
		return WorktreeFile{}, err
	}
	st, err := os.Stat(resolved)
	if err != nil {
		return WorktreeFile{}, err
	}
	if st.IsDir() {
		return WorktreeFile{}, fmt.Errorf("%w: path is a directory", ErrNotWorktree)
	}

	startDir := filepath.Dir(resolved)
	res, err := e.Run(ctx, RunOpts{
		Repo:    startDir,
		Args:    []string{"rev-parse", "--show-toplevel"},
		Timeout: 10 * time.Second,
	})
	if err != nil {
		return WorktreeFile{}, fmt.Errorf("%w: %v", ErrNotWorktree, err)
	}
	root := strings.TrimSpace(string(res.Stdout))
	if root == "" {
		return WorktreeFile{}, ErrNotWorktree
	}
	if resolvedRoot, err := filepath.EvalSymlinks(root); err == nil {
		root = resolvedRoot
	}
	root = filepath.Clean(root)

	rel, err := filepath.Rel(root, resolved)
	if err != nil {
		return WorktreeFile{}, err
	}
	rel = filepath.ToSlash(rel)
	if rel == "" || rel == "." || strings.HasPrefix(rel, "../") || strings.Contains(rel, "/../") || filepath.IsAbs(rel) {
		return WorktreeFile{}, fmt.Errorf("%w: invalid relative path %q", ErrNotWorktree, rel)
	}
	return WorktreeFile{Root: root, Rel: rel}, nil
}
