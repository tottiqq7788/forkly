package gitexec

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParsePorcelainV2(t *testing.T) {
	raw := []byte("1 AM N... 100644 100644 100644 abcd abcd README.md\x00? untracked.txt\x00u UU N... 100644 100644 100644 100644 ab cd ef conflict.txt\x00")
	files := parsePorcelainV2(raw)
	if len(files) < 2 {
		t.Fatalf("expected files, got %d", len(files))
	}
	foundUntracked := false
	foundConflict := false
	for _, f := range files {
		if f.Path == "untracked.txt" && f.Kind == StatusUntracked {
			foundUntracked = true
		}
		if f.Path == "conflict.txt" && f.Kind == StatusConflicted {
			foundConflict = true
		}
	}
	if !foundUntracked {
		t.Fatal("missing untracked")
	}
	if !foundConflict {
		t.Fatal("missing conflict")
	}
}

func TestAssertInsideRepo(t *testing.T) {
	dir := t.TempDir()
	if err := assertInsideRepo(dir, "a/b.txt"); err != nil {
		t.Fatal(err)
	}
	if err := assertInsideRepo(dir, "../escape"); err == nil {
		t.Fatal("expected escape error")
	}
}

func TestAssertInsideRepoRejectsSiblingPrefixSymlink(t *testing.T) {
	base := t.TempDir()
	repo := filepath.Join(base, "proj")
	sibling := filepath.Join(base, "proj-secrets")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(sibling, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sibling, "secret.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(repo, "link")
	if err := os.Symlink(sibling, link); err != nil {
		t.Skipf("symlink not supported: %v", err)
	}
	// Existing file through symlink escape
	if err := assertInsideRepo(repo, "link/secret.txt"); err == nil {
		t.Fatal("expected escape for existing symlink target")
	}
	// Deleted/missing path under symlink parent (prefix bypass case)
	if err := assertInsideRepo(repo, "link/deleted.txt"); err == nil {
		t.Fatal("expected escape for deleted path under symlink parent")
	}
}

func TestAssertObjectID(t *testing.T) {
	ok := []string{"abc1234", "0123456789abcdef0123456789abcdef01234567", "ABCDEF0"}
	for _, id := range ok {
		if err := assertObjectID(id); err != nil {
			t.Fatalf("%q should be ok: %v", id, err)
		}
	}
	bad := []string{"", "--output=/tmp/x", "-n", "HEAD", "abc", "zzzzzzz", "../foo"}
	for _, id := range bad {
		if err := assertObjectID(id); err == nil {
			t.Fatalf("%q should be rejected", id)
		}
	}
}

func TestPathsToNUL(t *testing.T) {
	b := pathsToNUL([]string{"a.txt", "b/c.txt"})
	if string(b) != "a.txt\x00b/c.txt\x00" {
		t.Fatalf("unexpected %q", b)
	}
}

func TestCountDiffStats(t *testing.T) {
	patch := "--- a\n+++ b\n@@\n-line\n+line2\n+line3\n"
	a, d := countDiffStats(patch)
	if a != 2 || d != 1 {
		t.Fatalf("got +%d -%d", a, d)
	}
}
