package gitexec

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveWorktreeFileRootAndNested(t *testing.T) {
	e := testExecutor(t)
	outer := t.TempDir()
	initRepo(t, outer)

	docs := filepath.Join(outer, "docs")
	if err := os.MkdirAll(docs, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(docs, "a.md")
	if err := os.WriteFile(file, []byte("# a\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	wf, err := e.ResolveWorktreeFile(context.Background(), file)
	if err != nil {
		t.Fatal(err)
	}
	wantRoot, err := filepath.EvalSymlinks(outer)
	if err != nil {
		t.Fatal(err)
	}
	if wf.Root != wantRoot {
		t.Fatalf("root=%q want %q", wf.Root, wantRoot)
	}
	if wf.Rel != "docs/a.md" {
		t.Fatalf("rel=%q want docs/a.md", wf.Rel)
	}

	inner := filepath.Join(outer, "vendor", "lib")
	if err := os.MkdirAll(inner, 0o755); err != nil {
		t.Fatal(err)
	}
	initRepo(t, inner)
	innerFile := filepath.Join(inner, "note.md")
	if err := os.WriteFile(innerFile, []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	nested, err := e.ResolveWorktreeFile(context.Background(), innerFile)
	if err != nil {
		t.Fatal(err)
	}
	wantInner, err := filepath.EvalSymlinks(inner)
	if err != nil {
		t.Fatal(err)
	}
	if nested.Root != wantInner {
		t.Fatalf("nested root=%q want %q", nested.Root, wantInner)
	}
	if nested.Rel != "note.md" {
		t.Fatalf("nested rel=%q want note.md", nested.Rel)
	}
}

func TestResolveWorktreeFileNotARepo(t *testing.T) {
	e := testExecutor(t)
	dir := t.TempDir()
	file := filepath.Join(dir, "alone.md")
	if err := os.WriteFile(file, []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := e.ResolveWorktreeFile(context.Background(), file)
	if !errors.Is(err, ErrNotWorktree) {
		t.Fatalf("want ErrNotWorktree, got %v", err)
	}
}

func TestResolveWorktreeFileUnicodeAndSpaces(t *testing.T) {
	e := testExecutor(t)
	root := filepath.Join(t.TempDir(), "我的 仓库")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	initRepo(t, root)
	dir := filepath.Join(root, "未命名 文件夹")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "新建 文档.md")
	if err := os.WriteFile(file, []byte("# hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	wf, err := e.ResolveWorktreeFile(context.Background(), file)
	if err != nil {
		t.Fatal(err)
	}
	if wf.Rel != "未命名 文件夹/新建 文档.md" {
		t.Fatalf("rel=%q", wf.Rel)
	}
}

func TestResolveWorktreeFileViaSymlink(t *testing.T) {
	e := testExecutor(t)
	root := t.TempDir()
	initRepo(t, root)
	realFile := filepath.Join(root, "real.md")
	if err := os.WriteFile(realFile, []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	linkDir := t.TempDir()
	link := filepath.Join(linkDir, "alias.md")
	if err := os.Symlink(realFile, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	wf, err := e.ResolveWorktreeFile(context.Background(), link)
	if err != nil {
		t.Fatal(err)
	}
	wantRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if wf.Root != wantRoot || wf.Rel != "real.md" {
		t.Fatalf("got root=%q rel=%q", wf.Root, wf.Rel)
	}
}
