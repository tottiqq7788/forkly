package gitexec

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListTreeWorktreeAndHead(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "tracked.txt", "committed\n", "add tracked")
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	special := filepath.Join(dir, "docs", "你好 world.txt")
	if err := os.WriteFile(special, []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "untracked.txt"), []byte("new\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	e := testExecutor(t)
	wt, err := e.ListTree(context.Background(), dir, SourceWorktree, "", 0, 50, nil)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]TreeEntry{}
	for _, ent := range wt.Entries {
		names[ent.Name] = ent
	}
	if _, ok := names[".git"]; ok {
		t.Fatal(".git should be hidden")
	}
	if _, ok := names["untracked.txt"]; !ok {
		t.Fatal("worktree should include untracked")
	}
	if _, ok := names["docs"]; !ok {
		t.Fatal("missing docs dir")
	}

	head, err := e.ListTree(context.Background(), dir, SourceHead, "", 0, 50, nil)
	if err != nil {
		t.Fatal(err)
	}
	headNames := map[string]bool{}
	for _, ent := range head.Entries {
		headNames[ent.Name] = true
	}
	if headNames["untracked.txt"] {
		t.Fatal("HEAD should not include untracked")
	}
	if !headNames["tracked.txt"] {
		t.Fatal("HEAD missing tracked.txt")
	}

	docs, err := e.ListTree(context.Background(), dir, SourceWorktree, "docs", 0, 50, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(docs.Entries) != 1 || docs.Entries[0].Name != "你好 world.txt" {
		t.Fatalf("docs entries=%#v", docs.Entries)
	}
}

func TestListTreeEmptyHead(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	e := testExecutor(t)
	listing, err := e.ListTree(context.Background(), dir, SourceHead, "", 0, 50, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !listing.EmptyHead {
		t.Fatal("expected emptyHead")
	}
	if len(listing.Entries) != 0 {
		t.Fatalf("entries=%#v", listing.Entries)
	}
}

func TestListTreePagination(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	for i := 0; i < 5; i++ {
		name := filepath.Join(dir, string(rune('a'+i))+".txt")
		if err := os.WriteFile(name, []byte("x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	e := testExecutor(t)
	page1, err := e.ListTree(context.Background(), dir, SourceWorktree, "", 0, 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(page1.Entries) != 2 || !page1.HasMore || page1.NextOffset != 2 {
		t.Fatalf("page1=%#v", page1)
	}
	page2, err := e.ListTree(context.Background(), dir, SourceWorktree, "", page1.NextOffset, 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(page2.Entries) != 2 {
		t.Fatalf("page2=%#v", page2)
	}
}

func TestReadContentWorktreeVsHead(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "note.txt", "old\n", "add note")
	if err := os.WriteFile(filepath.Join(dir, "note.txt"), []byte("new\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	e := testExecutor(t)
	wt, err := e.ReadContent(context.Background(), dir, SourceWorktree, "note.txt")
	if err != nil {
		t.Fatal(err)
	}
	if wt.Content != "new\n" {
		t.Fatalf("worktree content=%q", wt.Content)
	}
	head, err := e.ReadContent(context.Background(), dir, SourceHead, "note.txt")
	if err != nil {
		t.Fatal(err)
	}
	if head.Content != "old\n" {
		t.Fatalf("head content=%q", head.Content)
	}
}

func TestBrowseRejectsEscapeAndGit(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "a.txt", "a\n", "a")
	e := testExecutor(t)
	if _, err := e.ListTree(context.Background(), dir, SourceWorktree, "../outside", 0, 50, nil); err == nil {
		t.Fatal("expected escape error")
	}
	if _, err := e.ReadContent(context.Background(), dir, SourceWorktree, ".git/config"); err == nil {
		t.Fatal("expected .git reject")
	}
	if _, err := e.ReadContent(context.Background(), dir, SourceHead, ".git/config"); err == nil {
		t.Fatal("expected .git reject for head")
	}
	if _, err := e.ReadContent(context.Background(), dir, SourceWorktree, ".GIT/config"); err == nil {
		t.Fatal("expected .GIT reject")
	}
	if _, err := e.ReadContent(context.Background(), dir, SourceHead, ".Git/HEAD"); err == nil {
		t.Fatal("expected .Git reject for head")
	}
}

func TestBrowseRejectsOutsideSymlink(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "a.txt", "a\n", "a")
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secret, []byte("secret\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlink unsupported: %v", err)
	}
	e := testExecutor(t)
	if _, err := e.ListTree(context.Background(), dir, SourceWorktree, "escape", 0, 50, nil); err == nil {
		t.Fatal("expected symlink dir escape error")
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(secret, filepath.Join(dir, "leak.txt")); err != nil {
		t.Fatal(err)
	}
	content, err := e.ReadContent(context.Background(), dir, SourceWorktree, "leak.txt")
	if err != nil {
		t.Fatal(err)
	}
	if content.Content != "" || !strings.Contains(content.Message, "仓库外") {
		t.Fatalf("expected outside symlink message, got %#v", content)
	}
}

func TestReadContentBinaryAndImageMeta(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	bin := []byte{0x00, 0x01, 0x02, 0xff}
	if err := os.WriteFile(filepath.Join(dir, "data.bin"), bin, 0o644); err != nil {
		t.Fatal(err)
	}
	// minimal 1x1 png
	png := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
		0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
		0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00,
		0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	}
	if err := os.WriteFile(filepath.Join(dir, "dot.png"), png, 0o644); err != nil {
		t.Fatal(err)
	}
	e := testExecutor(t)
	b, err := e.ReadContent(context.Background(), dir, SourceWorktree, "data.bin")
	if err != nil {
		t.Fatal(err)
	}
	if b.Kind != DiffBinary || b.Content != "" {
		t.Fatalf("binary %#v", b)
	}
	img, err := e.ReadContent(context.Background(), dir, SourceWorktree, "dot.png")
	if err != nil {
		t.Fatal(err)
	}
	if img.Kind != DiffImage || !strings.HasPrefix(img.DataURL, "data:image/png;base64,") {
		t.Fatalf("image %#v", img)
	}
}

func TestNormalizeBrowsePath(t *testing.T) {
	ok, err := normalizeBrowsePath("docs/a.txt")
	if err != nil || ok != "docs/a.txt" {
		t.Fatalf("%q %v", ok, err)
	}
	if _, err := normalizeBrowsePath(".."); err == nil {
		t.Fatal("expected error")
	}
	if _, err := normalizeBrowsePath(".git/HEAD"); err == nil {
		t.Fatal("expected .git error")
	}
	if _, err := normalizeBrowsePath(".GIT/config"); err == nil {
		t.Fatal("expected .GIT error")
	}
	if _, err := normalizeBrowsePath("docs/.git/config"); err == nil {
		t.Fatal("expected nested .git error")
	}
	if _, err := normalizeBrowsePath("a/.GIT/HEAD"); err == nil {
		t.Fatal("expected nested .GIT error")
	}
	if _, err := normalizeBrowsePath("-rf"); err == nil {
		t.Fatal("expected dash path error")
	}
}

func TestMatchesHideRulesDSStore(t *testing.T) {
	rules := []string{"*.DS*"}
	if !MatchesHideRules(".DS_Store", ".DS_Store", rules) {
		t.Fatal("expected .DS_Store hidden")
	}
	if !MatchesHideRules(".DS_Store", "未命名文件夹/.DS_Store", rules) {
		t.Fatal("expected nested .DS_Store hidden")
	}
	if MatchesHideRules("本文件.txt", "本文件.txt", rules) {
		t.Fatal("normal file should show")
	}
}

func TestListTreeHidesByRules(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	if err := os.WriteFile(filepath.Join(dir, ".DS_Store"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "keep.txt"), []byte("k\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	e := testExecutor(t)
	listing, err := e.ListTree(context.Background(), dir, SourceWorktree, "", 0, 50, []string{"*.DS*"})
	if err != nil {
		t.Fatal(err)
	}
	for _, ent := range listing.Entries {
		if ent.Name == ".DS_Store" {
			t.Fatal(".DS_Store should be filtered")
		}
	}
}

func TestReadHeadOversizedSkipsMaterialize(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	// Just over MaxDiffBytes so HEAD preview must refuse full load.
	big := bytes.Repeat([]byte("a"), MaxDiffBytes+8)
	if err := os.WriteFile(filepath.Join(dir, "big.txt"), big, 0o644); err != nil {
		t.Fatal(err)
	}
	e := testExecutor(t)
	if _, err := e.Run(context.Background(), RunOpts{
		Repo: dir, Args: []string{"add", "big.txt"}, Write: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Run(context.Background(), RunOpts{
		Repo: dir, Args: []string{"commit", "-m", "big"}, Write: true,
	}); err != nil {
		t.Fatal(err)
	}
	content, err := e.ReadContent(context.Background(), dir, SourceHead, "big.txt")
	if err != nil {
		t.Fatal(err)
	}
	if content.Kind != DiffTooLarge || content.Content != "" || !content.Truncated {
		t.Fatalf("expected metadata-only too_large, got %#v", content)
	}
}
