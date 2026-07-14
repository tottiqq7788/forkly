package project

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/gitexec"
)

func testProjectService(t *testing.T) (*Service, *config.Store) {
	t.Helper()
	store, err := config.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	rt, err := gitexec.DiscoverRuntime("")
	if err != nil {
		t.Skip(err)
	}
	return NewService(store, gitexec.NewExecutor(rt)), store
}

func initGitDir(t *testing.T, dir string) {
	t.Helper()
	cmd := exec.Command("git", "init")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v (%s)", err, out)
	}
}

func TestEnsureRegisteredCreateAndReuse(t *testing.T) {
	svc, store := testProjectService(t)
	ctx := context.Background()
	root := t.TempDir()
	initGitDir(t, root)

	first, err := svc.EnsureRegistered(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if !first.Created {
		t.Fatal("expected created")
	}
	if first.Project.Name != filepath.Base(root) {
		t.Fatalf("name=%q", first.Project.Name)
	}
	if len(first.Project.HideRules) != 1 || first.Project.HideRules[0] != config.DefaultHideRule {
		t.Fatalf("hideRules=%v", first.Project.HideRules)
	}

	second, err := svc.EnsureRegistered(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if second.Created {
		t.Fatal("expected reuse")
	}
	if second.Project.ID != first.Project.ID {
		t.Fatalf("id mismatch %q vs %q", second.Project.ID, first.Project.ID)
	}
	if len(store.Snapshot().Projects) != 1 {
		t.Fatalf("projects=%d", len(store.Snapshot().Projects))
	}
}

func TestEnsureRegisteredSymlinkEquivalent(t *testing.T) {
	svc, _ := testProjectService(t)
	ctx := context.Background()
	root := t.TempDir()
	initGitDir(t, root)

	first, err := svc.EnsureRegistered(ctx, root)
	if err != nil {
		t.Fatal(err)
	}

	linkParent := t.TempDir()
	link := filepath.Join(linkParent, "alias")
	if err := os.Symlink(root, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	second, err := svc.EnsureRegistered(ctx, link)
	if err != nil {
		t.Fatal(err)
	}
	if second.Created || second.Project.ID != first.Project.ID {
		t.Fatalf("created=%v id=%q want %q", second.Created, second.Project.ID, first.Project.ID)
	}
}

func TestEnsureRegisteredConcurrentOnce(t *testing.T) {
	svc, store := testProjectService(t)
	ctx := context.Background()
	root := t.TempDir()
	initGitDir(t, root)

	const n = 16
	var wg sync.WaitGroup
	ids := make(chan string, n)
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			res, err := svc.EnsureRegistered(ctx, root)
			if err != nil {
				t.Errorf("ensure: %v", err)
				return
			}
			ids <- res.Project.ID
		}()
	}
	wg.Wait()
	close(ids)

	seen := map[string]struct{}{}
	for id := range ids {
		seen[id] = struct{}{}
	}
	if len(seen) != 1 {
		t.Fatalf("expected 1 id, got %v", seen)
	}
	if len(store.Snapshot().Projects) != 1 {
		t.Fatalf("projects=%d", len(store.Snapshot().Projects))
	}
}

func TestEnsureRegisteredRejectsBare(t *testing.T) {
	svc, store := testProjectService(t)
	ctx := context.Background()
	bare := t.TempDir()
	cmd := exec.Command("git", "init", "--bare")
	cmd.Dir = bare
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init --bare: %v (%s)", err, out)
	}
	before := len(store.Snapshot().Projects)
	_, err := svc.EnsureRegistered(ctx, bare)
	if err == nil {
		t.Fatal("expected bare rejection")
	}
	if len(store.Snapshot().Projects) != before {
		t.Fatal("config should be unchanged")
	}
}
