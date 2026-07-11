package gitexec

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func headSHA(t *testing.T, dir string) string {
	t.Helper()
	e := testExecutor(t)
	res, err := e.Run(context.Background(), RunOpts{
		Repo: dir,
		Args: []string{"rev-parse", "HEAD"},
	})
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(res.Stdout))
}

func TestDiffCommitFileAddedModifiedDeleted(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "note.txt", "hello\n", "add note")
	shaAdd := headSHA(t, dir)

	e := testExecutor(t)
	d, err := e.DiffCommitFile(context.Background(), dir, shaAdd, "note.txt")
	if err != nil {
		t.Fatal(err)
	}
	if d.Kind != DiffText || !strings.Contains(d.Patch, "+hello") {
		t.Fatalf("add diff: kind=%s patch=%q", d.Kind, d.Patch)
	}

	if err := os.WriteFile(filepath.Join(dir, "note.txt"), []byte("hello\nworld\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Run(context.Background(), RunOpts{
		Repo: dir, Args: []string{"add", "note.txt"}, Write: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Run(context.Background(), RunOpts{
		Repo: dir, Args: []string{"commit", "-m", "modify note"}, Write: true,
	}); err != nil {
		t.Fatal(err)
	}
	shaMod := headSHA(t, dir)
	d, err = e.DiffCommitFile(context.Background(), dir, shaMod, "note.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(d.Patch, "+world") {
		t.Fatalf("modify diff missing +world: %q", d.Patch)
	}

	if _, err := e.Run(context.Background(), RunOpts{
		Repo: dir, Args: []string{"rm", "note.txt"}, Write: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Run(context.Background(), RunOpts{
		Repo: dir, Args: []string{"commit", "-m", "delete note"}, Write: true,
	}); err != nil {
		t.Fatal(err)
	}
	shaDel := headSHA(t, dir)
	d, err = e.DiffCommitFile(context.Background(), dir, shaDel, "note.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(d.Patch, "-hello") && !strings.Contains(d.Patch, "-world") {
		t.Fatalf("delete diff unexpected: %q", d.Patch)
	}
}

func TestDiffCommitFileRenameAndSpecialPaths(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	e := testExecutor(t)

	special := "docs/你好 world.txt"
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	commitFile(t, dir, special, "alpha\n", "add special")

	if err := os.MkdirAll(filepath.Join(dir, "archive"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Run(context.Background(), RunOpts{
		Repo: dir, Args: []string{"mv", special, "archive/renamed.txt"}, Write: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Run(context.Background(), RunOpts{
		Repo: dir, Args: []string{"commit", "-m", "rename special"}, Write: true,
	}); err != nil {
		t.Fatal(err)
	}
	sha := headSHA(t, dir)
	d, err := e.DiffCommitFile(context.Background(), dir, sha, "archive/renamed.txt")
	if err != nil {
		t.Fatal(err)
	}
	if d.Kind != DiffText {
		t.Fatalf("kind=%s", d.Kind)
	}
	// Rename commits may show rename header and/or content; at least not error.
	if d.Patch == "" && d.Message == "" {
		t.Fatal("expected patch or message for rename")
	}

	// Original special path at first commit
	log, err := e.Log(context.Background(), dir, 10, "", "")
	if err != nil || len(log.Commits) < 2 {
		t.Fatalf("log: %v len=%d", err, len(log.Commits))
	}
	first := log.Commits[len(log.Commits)-1].SHA
	d, err = e.DiffCommitFile(context.Background(), dir, first, special)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(d.Patch, "+alpha") {
		t.Fatalf("special path add patch=%q", d.Patch)
	}
}

func TestDiffCommitFileRejectsEscapeAndBadSHA(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "a.txt", "a\n", "a")
	sha := headSHA(t, dir)
	e := testExecutor(t)
	if _, err := e.DiffCommitFile(context.Background(), dir, sha, "../outside.txt"); err == nil {
		t.Fatal("expected path escape error")
	}
	if _, err := e.DiffCommitFile(context.Background(), dir, "--output=/tmp/x", "a.txt"); err == nil {
		t.Fatal("expected bad sha error")
	}
}
