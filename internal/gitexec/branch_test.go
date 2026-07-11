package gitexec

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAssertBranchName(t *testing.T) {
	ok := []string{"main", "feature/login", "users/alice/device-1", "你好-分支", "v1.2.3-fix"}
	for _, name := range ok {
		if err := assertBranchName(name); err != nil {
			t.Fatalf("%q should be valid: %v", name, err)
		}
	}
	bad := []string{
		"", "  ", "-rf", "--help", "--output=/tmp/x", "HEAD", "head",
		"refs/heads/main", "foo..bar", "foo@{1}", "foo bar", "foo*",
		"foo/", "/foo", "foo.lock", "abc1234", "0123456789abcdef0123456789abcdef01234567",
	}
	for _, name := range bad {
		if err := assertBranchName(name); err == nil {
			t.Fatalf("%q should be invalid", name)
		}
	}
}

func currentBranch(t *testing.T, dir string) string {
	t.Helper()
	e := testExecutor(t)
	res, err := e.Run(context.Background(), RunOpts{
		Repo: dir, Args: []string{"symbolic-ref", "-q", "--short", "HEAD"},
	})
	if err != nil {
		t.Fatalf("current branch: %v", err)
	}
	return strings.TrimSpace(string(res.Stdout))
}

func TestListSwitchCreateRenameDeleteBranches(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "a.txt", "a\n", "first")
	e := testExecutor(t)

	list, err := e.ListBranches(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if !list.CanSwitch || list.Dirty || len(list.Branches) < 1 {
		t.Fatalf("list %#v", list)
	}

	created, err := e.CreateAndSwitchBranch(context.Background(), dir, "feature/login")
	if err != nil {
		t.Fatal(err)
	}
	if created.Branch != "feature/login" {
		t.Fatalf("created branch %q", created.Branch)
	}
	if currentBranch(t, dir) != "feature/login" {
		t.Fatal("not on feature/login")
	}

	mainName := "main"
	for _, b := range list.Branches {
		if b.Current {
			mainName = b.Name
			break
		}
	}
	_, err = e.SwitchBranch(context.Background(), dir, mainName)
	if err != nil {
		res, _ := e.Run(context.Background(), RunOpts{Repo: dir, Args: []string{"branch", "--list"}})
		t.Fatalf("switch to %s: %v (%s)", mainName, err, res.Stdout)
	}

	renamed, err := e.RenameBranch(context.Background(), dir, "feature/login", "feature/auth")
	if err != nil {
		t.Fatal(err)
	}
	_ = renamed
	exists, err := e.localBranchExists(context.Background(), dir, "feature/auth")
	if err != nil || !exists {
		t.Fatalf("rename missing: %v %v", exists, err)
	}

	deleted, err := e.DeleteBranch(context.Background(), dir, "feature/auth")
	if err != nil {
		t.Fatal(err)
	}
	_ = deleted
	exists, _ = e.localBranchExists(context.Background(), dir, "feature/auth")
	if exists {
		t.Fatal("branch still exists after delete")
	}
}

func TestSwitchRejectsDirtyWorktree(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "a.txt", "a\n", "first")
	e := testExecutor(t)
	if _, err := e.CreateAndSwitchBranch(context.Background(), dir, "other"); err != nil {
		t.Fatal(err)
	}
	main := "main"
	list, _ := e.ListBranches(context.Background(), dir)
	for _, b := range list.Branches {
		if b.Name != "other" {
			main = b.Name
			break
		}
	}
	_, _ = e.SwitchBranch(context.Background(), dir, main)
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("dirty\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := e.SwitchBranch(context.Background(), dir, "other")
	if err == nil || !strings.Contains(err.Error(), "未保存") {
		t.Fatalf("want dirty rejection, got %v", err)
	}
	_, err = e.CreateAndSwitchBranch(context.Background(), dir, "another")
	if err == nil || !strings.Contains(err.Error(), "未保存") {
		t.Fatalf("want dirty rejection on create, got %v", err)
	}
}

func TestDeleteCurrentBranchRejected(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "a.txt", "a\n", "first")
	e := testExecutor(t)
	cur := currentBranch(t, dir)
	_, err := e.DeleteBranch(context.Background(), dir, cur)
	if err == nil || !strings.Contains(err.Error(), "当前分支") {
		t.Fatalf("want current delete rejection, got %v", err)
	}
}

func TestDeleteUnmergedBranchRejected(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "a.txt", "a\n", "first")
	e := testExecutor(t)
	main := currentBranch(t, dir)
	if _, err := e.CreateAndSwitchBranch(context.Background(), dir, "wip"); err != nil {
		t.Fatal(err)
	}
	commitFile(t, dir, "wip.txt", "wip\n", "wip commit")
	if _, err := e.SwitchBranch(context.Background(), dir, main); err != nil {
		t.Fatal(err)
	}
	_, err := e.DeleteBranch(context.Background(), dir, "wip")
	if err == nil {
		t.Fatal("unmerged branch should not delete with -d")
	}
}

func TestChineseAndSlashBranchNames(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "a.txt", "a\n", "first")
	e := testExecutor(t)
	if _, err := e.CreateAndSwitchBranch(context.Background(), dir, "功能/登录"); err != nil {
		t.Fatal(err)
	}
	if currentBranch(t, dir) != "功能/登录" {
		t.Fatalf("got %s", currentBranch(t, dir))
	}
}

func TestCreateDuplicateRejected(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "a.txt", "a\n", "first")
	e := testExecutor(t)
	if _, err := e.CreateAndSwitchBranch(context.Background(), dir, "dup"); err != nil {
		t.Fatal(err)
	}
	main := "main"
	list, _ := e.ListBranches(context.Background(), dir)
	for _, b := range list.Branches {
		if !b.Current {
			main = b.Name
		}
	}
	// get non-current
	for _, b := range list.Branches {
		if b.Name != "dup" {
			main = b.Name
			break
		}
	}
	_, _ = e.SwitchBranch(context.Background(), dir, main)
	_, err := e.CreateAndSwitchBranch(context.Background(), dir, "dup")
	if err == nil || !strings.Contains(err.Error(), "已存在") {
		t.Fatalf("want duplicate rejection, got %v", err)
	}
}

func TestSwitchMissingBranch(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "a.txt", "a\n", "first")
	e := testExecutor(t)
	_, err := e.SwitchBranch(context.Background(), dir, "nope")
	if err == nil || !strings.Contains(err.Error(), "不存在") {
		t.Fatalf("want missing branch error, got %v", err)
	}
}

func TestSwitchFromDetachedHEAD(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "a.txt", "a\n", "first")
	e := testExecutor(t)
	main := currentBranch(t, dir)
	sha := headSHA(t, dir)
	if _, err := e.Run(context.Background(), RunOpts{
		Repo: dir, Args: []string{"checkout", "--detach", sha}, Write: true,
	}); err != nil {
		t.Fatal(err)
	}
	list, err := e.ListBranches(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if !list.Detached || !list.CanSwitch {
		t.Fatalf("detached list %#v", list)
	}
	if _, err := e.SwitchBranch(context.Background(), dir, main); err != nil {
		t.Fatal(err)
	}
	if currentBranch(t, dir) != main {
		t.Fatal("failed to leave detached")
	}
}

func TestListBranchesEmptyRepo(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	e := testExecutor(t)
	list, err := e.ListBranches(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if list.HasHead {
		t.Fatal("empty repo should not have HEAD")
	}
	if list.Dirty {
		t.Fatal("empty should be clean")
	}
}
