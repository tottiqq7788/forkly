package gitexec

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileOpsCreateRenameDelete(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	e := testExecutor(t)

	if _, err := e.CreateFolder(dir, "", "docs"); err != nil {
		t.Fatal(err)
	}
	file, err := e.CreateFile(dir, "docs", "note.md")
	if err != nil {
		t.Fatal(err)
	}
	if file.Path != "docs/note.md" || file.Kind != "file" {
		t.Fatalf("file=%#v", file)
	}
	if _, err := os.Stat(filepath.Join(dir, "docs", "note.md")); err != nil {
		t.Fatal(err)
	}

	renamed, err := e.RenameEntry(dir, "docs/note.md", "renamed.md")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Path != "docs/renamed.md" {
		t.Fatalf("renamed=%#v", renamed)
	}
	if _, err := os.Stat(filepath.Join(dir, "docs", "renamed.md")); err != nil {
		t.Fatal(err)
	}

	if err := e.DeleteEntry(dir, "docs/renamed.md"); err != nil {
		t.Fatal(err)
	}
	if err := e.DeleteEntry(dir, "docs"); err != nil {
		t.Fatal(err)
	}
}

func TestFileOpsRejectUnsafePaths(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	e := testExecutor(t)

	cases := []struct {
		name string
		run  func() error
	}{
		{"escape parent", func() error {
			_, err := e.CreateFile(dir, "../outside", "x.txt")
			return err
		}},
		{"slash in name", func() error {
			_, err := e.CreateFile(dir, "", "nested/x.txt")
			return err
		}},
		{"git metadata", func() error {
			_, err := e.CreateFolder(dir, "", ".git")
			return err
		}},
		{"root rename", func() error {
			_, err := e.RenameEntry(dir, "", "new")
			return err
		}},
		{"root delete", func() error {
			return e.DeleteEntry(dir, "")
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.run(); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestFileOpsRejectExistingAndNonEmptyDirectory(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	e := testExecutor(t)

	if _, err := e.CreateFile(dir, "", "a.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.CreateFile(dir, "", "a.txt"); err == nil {
		t.Fatal("expected existing file error")
	}
	if _, err := e.CreateFolder(dir, "", "docs"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.RenameEntry(dir, "a.txt", "docs"); err == nil {
		t.Fatal("expected existing target error")
	}
	if _, err := e.CreateFile(dir, "docs", "note.md"); err != nil {
		t.Fatal(err)
	}
	if err := e.DeleteEntry(dir, "docs"); err == nil || !strings.Contains(err.Error(), "空文件夹") {
		t.Fatalf("expected non-empty dir error, got %v", err)
	}
}

func TestFileOpsDeleteSymlinkItself(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	outside := t.TempDir()
	link := filepath.Join(dir, "outside-link")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlink unsupported: %v", err)
	}

	e := testExecutor(t)
	if err := e.DeleteEntry(dir, "outside-link"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(link); !os.IsNotExist(err) {
		t.Fatalf("expected link removed, err=%v", err)
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("target should remain: %v", err)
	}
}

func TestResolveWorktreePathRejectsEscape(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	e := testExecutor(t)

	if got, err := e.ResolveWorktreePath(dir, ""); err != nil || got != dir {
		t.Fatalf("root got=%q err=%v", got, err)
	}
	if _, err := e.ResolveWorktreePath(dir, "../outside"); err == nil {
		t.Fatal("expected escape error")
	}
}
