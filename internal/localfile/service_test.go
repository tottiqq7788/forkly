package localfile_test

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/forkly-app/forkly/internal/gitexec"
	"github.com/forkly-app/forkly/internal/localfile"
)

func newService(t *testing.T) *localfile.Service {
	t.Helper()
	rt, err := gitexec.DiscoverRuntime(gitexec.ResourcesDir())
	if err != nil {
		t.Fatal(err)
	}
	return localfile.NewService(gitexec.NewExecutor(rt))
}

func writeMD(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestOpenRejectsNonMarkdownAndMissing(t *testing.T) {
	s := newService(t)
	dir := t.TempDir()
	txt := writeMD(t, dir, "note.txt", "hi")
	if _, err := s.Open(txt); err == nil || !strings.Contains(err.Error(), "Markdown") {
		t.Fatalf("expected markdown rejection, got %v", err)
	}
	if _, err := s.Open(filepath.Join(dir, "missing.md")); err == nil {
		t.Fatal("expected missing file error")
	}
}

func TestOpenReusesIDAndRejectsUnknown(t *testing.T) {
	s := newService(t)
	dir := t.TempDir()
	path := writeMD(t, dir, "a.md", "# a\n")
	m1, err := s.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	m2, err := s.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if m1.FileID == "" || m1.FileID != m2.FileID {
		t.Fatalf("expected reused id, got %q vs %q", m1.FileID, m2.FileID)
	}
	if m1.AbsPath == "" || m1.Name != "a.md" {
		t.Fatalf("unexpected meta %+v", m1)
	}
	if _, err := s.Get("does-not-exist"); err == nil {
		t.Fatal("expected unknown id error")
	}
}

func TestSymlinkResolvesToRealFile(t *testing.T) {
	s := newService(t)
	dir := t.TempDir()
	target := writeMD(t, dir, "real.md", "# real\n")
	link := filepath.Join(dir, "link.md")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	viaLink, err := s.Open(link)
	if err != nil {
		t.Fatal(err)
	}
	viaReal, err := s.Open(target)
	if err != nil {
		t.Fatal(err)
	}
	if viaLink.FileID != viaReal.FileID {
		t.Fatalf("symlink should reuse real file id: %q vs %q", viaLink.FileID, viaReal.FileID)
	}
	resolved, err := filepath.EvalSymlinks(target)
	if err != nil {
		t.Fatal(err)
	}
	if viaLink.AbsPath != resolved {
		t.Fatalf("expected abs path %q, got %q", resolved, viaLink.AbsPath)
	}
}

func TestOversizeRejected(t *testing.T) {
	s := newService(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "big.md")
	big := bytes.Repeat([]byte("a"), gitexec.MaxEditBytes+1)
	if err := os.WriteFile(path, big, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Open(path); err == nil || !strings.Contains(err.Error(), "上限") {
		t.Fatalf("expected size rejection, got %v", err)
	}
}

func TestReadWriteConflictAndBOM(t *testing.T) {
	s := newService(t)
	dir := t.TempDir()
	path := writeMD(t, dir, "note.md", "\ufeffline\r\n")
	meta, err := s.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	fc, _, err := s.ReadContent(context.Background(), meta.FileID)
	if err != nil {
		t.Fatal(err)
	}
	if !fc.HasUtf8Bom || fc.LineEnding != "crlf" {
		t.Fatalf("expected BOM+CRLF meta, got bom=%v ending=%q", fc.HasUtf8Bom, fc.LineEnding)
	}
	res, err := s.WriteContent(meta.FileID, "updated\n", fc.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.WriteContent(meta.FileID, "stale\n", fc.Revision); err == nil {
		t.Fatal("expected revision conflict")
	} else {
		var conflict *gitexec.ContentConflict
		if !errors.As(err, &conflict) {
			t.Fatalf("expected ContentConflict, got %T %v", err, err)
		}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(raw, []byte{0xEF, 0xBB, 0xBF}) {
		t.Fatalf("expected BOM preserved, got %q", raw)
	}
	if !strings.Contains(string(raw), "updated") {
		t.Fatalf("expected updated content, got %q", raw)
	}
	_ = res
}

func TestAssetAndOpenRelativeBounds(t *testing.T) {
	s := newService(t)
	dir := t.TempDir()
	path := writeMD(t, dir, "doc.md", "# doc\n")
	writeMD(t, dir, "sib.md", "# sib\n")
	outside := writeMD(t, filepath.Dir(dir), "outside.md", "# out\n")
	_ = outside
	meta, err := s.Open(path)
	if err != nil {
		t.Fatal(err)
	}

	png := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
		0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
		0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
		0x00, 0x05, 0xfe, 0x02, 0xfe, 0xa1, 0x05, 0x9e,
		0x3c, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
		0x44, 0xae, 0x42, 0x60, 0x82,
	}
	asset, err := s.WriteAsset(meta.FileID, "shot.png", png)
	if err != nil {
		t.Fatal(err)
	}
	mime, data, _, err := s.ReadAsset(context.Background(), meta.FileID, asset.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(mime, "image/png") || len(data) == 0 {
		t.Fatalf("unexpected asset mime=%q len=%d", mime, len(data))
	}
	if _, _, _, err := s.ReadAsset(context.Background(), meta.FileID, "../outside.png"); err == nil {
		t.Fatal("expected path escape rejection")
	}
	if _, _, _, err := s.ReadAsset(context.Background(), meta.FileID, ".git/config"); err == nil {
		t.Fatal("expected .git rejection")
	}

	sib, err := s.OpenRelative(meta.FileID, "sib.md")
	if err != nil {
		t.Fatal(err)
	}
	if sib.Name != "sib.md" || sib.FileID == "" {
		t.Fatalf("unexpected relative meta %+v", sib)
	}
	if _, err := s.OpenRelative(meta.FileID, "../outside.md"); err == nil {
		t.Fatal("expected relative escape rejection")
	}
}
