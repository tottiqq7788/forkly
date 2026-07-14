package app

import (
	"context"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/gitexec"
	"github.com/forkly-app/forkly/internal/localfile"
	"github.com/forkly-app/forkly/internal/project"
)

type captureLog struct {
	msgs []string
}

func (c *captureLog) Error(msg string, args ...any) {
	c.msgs = append(c.msgs, msg)
}

type failingRegistrar struct {
	err error
}

func (f failingRegistrar) EnsureRegistered(context.Context, string) (project.EnsureResult, error) {
	return project.EnsureResult{}, f.err
}

func openTargetFixture(t *testing.T) (openTargetDeps, *config.Store, *project.Service) {
	t.Helper()
	store, err := config.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	rt, err := gitexec.DiscoverRuntime("")
	if err != nil {
		t.Skip(err)
	}
	git := gitexec.NewExecutor(rt)
	projects := project.NewService(store, git)
	return openTargetDeps{
		git:        git,
		projects:   projects,
		localFiles: localfile.NewService(git),
		log:        &captureLog{},
	}, store, projects
}

func initOpenRepo(t *testing.T, dir string) {
	t.Helper()
	cmd := exec.Command("git", "init")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v (%s)", err, out)
	}
}

func TestResolveOpenDocumentTargetProjectRootFile(t *testing.T) {
	deps, store, _ := openTargetFixture(t)
	root := t.TempDir()
	initOpenRepo(t, root)
	file := filepath.Join(root, "README.md")
	if err := os.WriteFile(file, []byte("# hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	target, err := resolveOpenDocumentTarget(context.Background(), deps, file)
	if err != nil {
		t.Fatal(err)
	}
	if !target.ProjectCreated || target.ProjectID == "" {
		t.Fatalf("expected new project, got %#v", target)
	}
	if !strings.HasPrefix(target.Next, "/projects/"+url.PathEscape(target.ProjectID)+"/editor?path=") {
		t.Fatalf("next=%q", target.Next)
	}
	q, err := url.Parse(target.Next)
	if err != nil {
		t.Fatal(err)
	}
	if q.Query().Get("path") != "README.md" {
		t.Fatalf("path query=%q", q.Query().Get("path"))
	}
	if len(store.Snapshot().Projects) != 1 {
		t.Fatalf("projects=%d", len(store.Snapshot().Projects))
	}
}

func TestResolveOpenDocumentTargetNestedEncodedPath(t *testing.T) {
	deps, _, _ := openTargetFixture(t)
	root := t.TempDir()
	initOpenRepo(t, root)
	dir := filepath.Join(root, "docs sub")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "你好.md")
	if err := os.WriteFile(file, []byte("# n\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	target, err := resolveOpenDocumentTarget(context.Background(), deps, file)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(target.Next)
	if err != nil {
		t.Fatal(err)
	}
	if got := parsed.Query().Get("path"); got != "docs sub/你好.md" {
		t.Fatalf("path=%q", got)
	}
}

func TestResolveOpenDocumentTargetReuseRegistered(t *testing.T) {
	deps, _, projects := openTargetFixture(t)
	root := t.TempDir()
	initOpenRepo(t, root)
	file := filepath.Join(root, "a.md")
	if err := os.WriteFile(file, []byte("a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	first, err := projects.EnsureRegistered(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}

	target, err := resolveOpenDocumentTarget(context.Background(), deps, file)
	if err != nil {
		t.Fatal(err)
	}
	if target.ProjectCreated {
		t.Fatal("expected reuse")
	}
	if target.ProjectID != first.Project.ID {
		t.Fatalf("id=%q want %q", target.ProjectID, first.Project.ID)
	}
}

func TestResolveOpenDocumentTargetNonGitFallback(t *testing.T) {
	deps, store, _ := openTargetFixture(t)
	dir := t.TempDir()
	file := filepath.Join(dir, "alone.md")
	if err := os.WriteFile(file, []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	target, err := resolveOpenDocumentTarget(context.Background(), deps, file)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(target.Next, "/editor/local/") {
		t.Fatalf("next=%q", target.Next)
	}
	if target.ProjectID != "" {
		t.Fatalf("unexpected project %#v", target)
	}
	if len(store.Snapshot().Projects) != 0 {
		t.Fatal("should not register project")
	}
}

func TestResolveOpenDocumentTargetEnsureFailureFallback(t *testing.T) {
	deps, store, _ := openTargetFixture(t)
	deps.projects = failingRegistrar{err: errors.New("register denied")}
	root := t.TempDir()
	initOpenRepo(t, root)
	file := filepath.Join(root, "a.md")
	if err := os.WriteFile(file, []byte("a\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	target, err := resolveOpenDocumentTarget(context.Background(), deps, file)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(target.Next, "/editor/local/") {
		t.Fatalf("next=%q", target.Next)
	}
	if target.ProjectID != "" {
		t.Fatalf("unexpected project %#v", target)
	}
	if len(store.Snapshot().Projects) != 0 {
		t.Fatal("should not register project")
	}
	cl := deps.log.(*captureLog)
	if len(cl.msgs) == 0 || !strings.Contains(cl.msgs[0], "auto-register") {
		t.Fatalf("expected ensure failure log, got %#v", cl.msgs)
	}
}
