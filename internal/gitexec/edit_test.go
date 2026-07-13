package gitexec

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestWriteContentEmptyAndRoundTrip(t *testing.T) {
	repo := t.TempDir()
	initRepo(t, repo)
	path := filepath.Join(repo, "note.md")
	if err := os.WriteFile(path, []byte(""), 0o644); err != nil {
		t.Fatal(err)
	}
	e := testExecutor(t)
	fc, err := e.ReadContent(context.Background(), repo, SourceWorktree, "note.md")
	if err != nil {
		t.Fatal(err)
	}
	if !fc.Editable {
		t.Fatalf("empty markdown should be editable: %+v", fc)
	}
	if fc.Content != "" {
		t.Fatalf("expected empty content, got %q", fc.Content)
	}
	if fc.Revision == "" {
		t.Fatal("missing revision")
	}

	res, err := e.WriteContent(repo, "note.md", "# Hi\n", fc.Revision)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "# Hi\n" {
		t.Fatalf("got %q", data)
	}
	if res.Revision != contentRevision(data) {
		t.Fatalf("revision mismatch")
	}
}

func TestWriteContentConflictAndConcurrent(t *testing.T) {
	repo := t.TempDir()
	initRepo(t, repo)
	path := filepath.Join(repo, "a.md")
	if err := os.WriteFile(path, []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	e := testExecutor(t)
	fc, err := e.ReadContent(context.Background(), repo, SourceWorktree, "a.md")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := e.WriteContent(repo, "a.md", "two\n", "deadbeef"); err == nil {
		t.Fatal("expected conflict")
	} else {
		var conflict *ContentConflict
		if !errors.As(err, &conflict) {
			t.Fatalf("want ContentConflict, got %v", err)
		}
	}

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			_, err := e.WriteContent(repo, "a.md", strings.Repeat("x", n+1)+"\n", fc.Revision)
			errs <- err
		}(i)
	}
	wg.Wait()
	close(errs)
	var ok, conflict int
	for err := range errs {
		if err == nil {
			ok++
		} else if errors.Is(err, ErrContentConflict) {
			conflict++
		} else {
			t.Fatalf("unexpected err: %v", err)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatalf("expected 1 success + 1 conflict, got ok=%d conflict=%d", ok, conflict)
	}
}

func TestWriteContentPreservesCRLFAndBOM(t *testing.T) {
	repo := t.TempDir()
	initRepo(t, repo)
	raw := append([]byte{0xEF, 0xBB, 0xBF}, []byte("hello\r\n")...)
	if err := os.WriteFile(filepath.Join(repo, "crlf.md"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	e := testExecutor(t)
	fc, err := e.ReadContent(context.Background(), repo, SourceWorktree, "crlf.md")
	if err != nil {
		t.Fatal(err)
	}
	if !fc.HasUtf8Bom || fc.LineEnding != "crlf" || fc.Content != "hello\n" {
		t.Fatalf("meta mismatch: %+v", fc)
	}
	if _, err := e.WriteContent(repo, "crlf.md", "world\n", fc.Revision); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(repo, "crlf.md"))
	if err != nil {
		t.Fatal(err)
	}
	want := append([]byte{0xEF, 0xBB, 0xBF}, []byte("world\r\n")...)
	if !bytes.Equal(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestWriteContentRejectsEscapeAndGit(t *testing.T) {
	repo := t.TempDir()
	initRepo(t, repo)
	e := testExecutor(t)
	if _, err := e.WriteContent(repo, "../x.md", "a", "r"); err == nil {
		t.Fatal("expected escape error")
	}
	if _, err := e.WriteContent(repo, ".git/config", "a", "r"); err == nil {
		t.Fatal("expected .git error")
	}
	if _, err := e.WriteContent(repo, "docs/.git/config", "a", "r"); err == nil {
		t.Fatal("expected nested .git error")
	}
	if _, err := e.WriteContent(repo, "notes/.GIT/HEAD", "a", "r"); err == nil {
		t.Fatal("expected nested .GIT error")
	}
}

func TestWriteContentAllowsPlainText(t *testing.T) {
	repo := t.TempDir()
	initRepo(t, repo)
	if err := os.WriteFile(filepath.Join(repo, "a.txt"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "cfg.json"), []byte(`{"a":1}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	e := testExecutor(t)
	fc, err := e.ReadContent(context.Background(), repo, SourceWorktree, "a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !fc.Editable {
		t.Fatal("plain UTF-8 text should be editable")
	}
	res, err := e.WriteContent(repo, "a.txt", "bye\n", fc.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if res.Revision == "" {
		t.Fatal("expected revision")
	}
	raw, err := os.ReadFile(filepath.Join(repo, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "bye\n" {
		t.Fatalf("got %q", raw)
	}

	jc, err := e.ReadContent(context.Background(), repo, SourceWorktree, "cfg.json")
	if err != nil {
		t.Fatal(err)
	}
	if !jc.Editable || jc.Kind != DiffText {
		t.Fatalf("json should be editable kind=%s editable=%v", jc.Kind, jc.Editable)
	}
	if _, err := e.WriteContent(repo, "cfg.json", "{\"a\":2}\n", jc.Revision); err != nil {
		t.Fatal(err)
	}
}

func TestWriteContentRejectsBinary(t *testing.T) {
	repo := t.TempDir()
	initRepo(t, repo)
	if err := os.WriteFile(filepath.Join(repo, "bin.dat"), []byte{0x00, 0x01, 0x02}, 0o644); err != nil {
		t.Fatal(err)
	}
	e := testExecutor(t)
	fc, err := e.ReadContent(context.Background(), repo, SourceWorktree, "bin.dat")
	if err != nil {
		t.Fatal(err)
	}
	if fc.Editable || fc.Kind != DiffBinary {
		t.Fatalf("binary should not be editable kind=%s editable=%v", fc.Kind, fc.Editable)
	}
	if _, err := e.WriteContent(repo, "bin.dat", "nope\n", "deadbeef"); err == nil {
		t.Fatal("expected binary rejection")
	}
}

func TestNormalizeBrowsePathRejectsNestedGit(t *testing.T) {
	if _, err := normalizeBrowsePath("vendor/.git/config"); err == nil {
		t.Fatal("expected nested .git reject")
	}
	if _, err := normalizeBrowsePath("a/.GIT/HEAD"); err == nil {
		t.Fatal("expected nested .GIT reject")
	}
}

func TestWriteContentRejectsSymlink(t *testing.T) {
	repo := t.TempDir()
	initRepo(t, repo)
	target := filepath.Join(repo, "real.md")
	if err := os.WriteFile(target, []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(repo, "link.md")
	if err := os.Symlink(target, link); err != nil {
		t.Skip("symlink not supported")
	}
	e := testExecutor(t)
	sum := sha256.Sum256([]byte("x\n"))
	rev := hex.EncodeToString(sum[:])
	if _, err := e.WriteContent(repo, "link.md", "y\n", rev); err == nil {
		t.Fatal("expected symlink rejection")
	}
}

func TestWriteAssetAndReadAsset(t *testing.T) {
	repo := t.TempDir()
	initRepo(t, repo)
	if err := os.WriteFile(filepath.Join(repo, "doc.md"), []byte("# d\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	png := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 1, 2, 3}
	e := testExecutor(t)
	res, err := e.WriteAsset(repo, "doc.md", "shot.png", png)
	if err != nil {
		t.Fatal(err)
	}
	if res.RelativePath != "assets/shot.png" {
		t.Fatalf("rel=%q", res.RelativePath)
	}
	mime, data, rev, err := e.ReadAssetBytes(context.Background(), repo, SourceWorktree, res.Path)
	if err != nil {
		t.Fatal(err)
	}
	if mime != "image/png" || !bytes.Equal(data, png) || rev == "" {
		t.Fatalf("asset mismatch mime=%s rev=%s", mime, rev)
	}
	res2, err := e.WriteAsset(repo, "doc.md", "shot.png", png)
	if err != nil {
		t.Fatal(err)
	}
	if res2.RelativePath != "assets/shot-1.png" {
		t.Fatalf("expected unique name, got %q", res2.RelativePath)
	}
}

func TestWriteAssetRejectsSVGAndOversize(t *testing.T) {
	repo := t.TempDir()
	initRepo(t, repo)
	if err := os.WriteFile(filepath.Join(repo, "doc.md"), []byte("# d\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	e := testExecutor(t)
	if _, err := e.WriteAsset(repo, "doc.md", "x.svg", []byte("<svg xmlns='http://www.w3.org/2000/svg'></svg>")); err == nil {
		t.Fatal("svg should be rejected")
	}
	big := append([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, bytes.Repeat([]byte{1}, MaxAssetUploadBytes)...)
	if _, err := e.WriteAsset(repo, "doc.md", "big.png", big); err == nil {
		t.Fatal("oversize should be rejected")
	}
}

func TestWriteAssetRejectsNonMarkdownParent(t *testing.T) {
	repo := t.TempDir()
	initRepo(t, repo)
	if err := os.WriteFile(filepath.Join(repo, "notes.txt"), []byte("plain\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	png := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 1, 2, 3}
	e := testExecutor(t)
	if _, err := e.WriteAsset(repo, "notes.txt", "shot.png", png); err == nil {
		t.Fatal("asset upload beside non-markdown should be rejected")
	}
}
