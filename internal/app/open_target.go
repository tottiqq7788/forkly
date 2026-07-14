package app

import (
	"context"
	"errors"
	"fmt"
	"net/url"

	"github.com/forkly-app/forkly/internal/gitexec"
	"github.com/forkly-app/forkly/internal/localfile"
	"github.com/forkly-app/forkly/internal/project"
)

// openDocumentTarget is the browser claim next path for a system-opened Markdown file.
type openDocumentTarget struct {
	Next           string
	ProjectID      string
	ProjectPath    string
	ProjectCreated bool
}

type openTargetLogger interface {
	Error(msg string, args ...any)
}

type projectRegistrar interface {
	EnsureRegistered(ctx context.Context, repoPath string) (project.EnsureResult, error)
}

type openTargetDeps struct {
	git        *gitexec.Executor
	projects   projectRegistrar
	localFiles *localfile.Service
	log        openTargetLogger
}

func resolveOpenDocumentTarget(ctx context.Context, deps openTargetDeps, absPath string) (openDocumentTarget, error) {
	wf, err := deps.git.ResolveWorktreeFile(ctx, absPath)
	if err == nil {
		ensured, ensureErr := deps.projects.EnsureRegistered(ctx, wf.Root)
		if ensureErr == nil {
			next := "/projects/" + url.PathEscape(ensured.Project.ID) + "/editor?path=" + url.QueryEscape(wf.Rel)
			return openDocumentTarget{
				Next:           next,
				ProjectID:      ensured.Project.ID,
				ProjectPath:    ensured.Project.Path,
				ProjectCreated: ensured.Created,
			}, nil
		}
		if deps.log != nil {
			deps.log.Error("auto-register project for open file failed; falling back to local session",
				"path", absPath, "root", wf.Root, "err", ensureErr)
		}
	} else if !errors.Is(err, gitexec.ErrNotWorktree) {
		if deps.log != nil {
			deps.log.Error("resolve git worktree for open file failed; falling back to local session",
				"path", absPath, "err", err)
		}
	}

	meta, openErr := deps.localFiles.Open(absPath)
	if openErr != nil {
		return openDocumentTarget{}, fmt.Errorf("open local markdown: %w", openErr)
	}
	return openDocumentTarget{
		Next: "/editor/local/" + url.PathEscape(meta.FileID),
	}, nil
}
