package gitexec_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/forkly-app/forkly/internal/gitexec"
)

func TestCommitOnlySelected(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v: %s", args, out)
		}
	}
	run("init", "-b", "main")
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a1\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("b1\n"), 0o644)
	run("add", ".")
	run("commit", "-m", "init")
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a2\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("b2\n"), 0o644)
	// stage only b externally
	run("add", "b.txt")

	rt, err := gitexec.DiscoverRuntime("")
	if err != nil {
		t.Fatal(err)
	}
	ex := gitexec.NewExecutor(rt)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	snap, err := ex.Status(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	_, err = ex.Commit(ctx, dir, gitexec.CommitRequest{
		Paths:       []string{"a.txt"},
		Message:     "only a",
		AuthorName:  "t",
		AuthorEmail: "t@t",
		Fingerprint: snap.Fingerprint,
	})
	if err != nil {
		t.Fatal(err)
	}
	// b should still be modified/staged
	snap2, err := ex.Status(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	foundB := false
	for _, f := range snap2.Files {
		if f.Path == "b.txt" {
			foundB = true
		}
		if f.Path == "a.txt" {
			t.Fatal("a should be clean")
		}
	}
	if !foundB {
		t.Fatal("expected b still dirty")
	}
}
