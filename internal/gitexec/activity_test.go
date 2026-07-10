package gitexec

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func testExecutor(t *testing.T) *Executor {
	t.Helper()
	rt, err := DiscoverRuntime("")
	if err != nil {
		t.Skipf("git unavailable: %v", err)
	}
	return NewExecutor(rt)
}

func initRepo(t *testing.T, dir string) {
	t.Helper()
	e := testExecutor(t)
	res, err := e.Run(context.Background(), RunOpts{
		Repo:  dir,
		Args:  []string{"init"},
		Write: true,
	})
	if err != nil {
		t.Fatalf("git init: %v (%s)", err, res.Stderr)
	}
	_, _ = e.Run(context.Background(), RunOpts{
		Repo:  dir,
		Args:  []string{"config", "user.email", "test@example.com"},
		Write: true,
	})
	_, _ = e.Run(context.Background(), RunOpts{
		Repo:  dir,
		Args:  []string{"config", "user.name", "Test"},
		Write: true,
	})
}

func commitFile(t *testing.T, dir, name, content, msg string) {
	t.Helper()
	e := testExecutor(t)
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Run(context.Background(), RunOpts{
		Repo: dir, Args: []string{"add", name}, Write: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Run(context.Background(), RunOpts{
		Repo: dir, Args: []string{"commit", "-m", msg}, Write: true,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestCountCommitsEmptyRepo(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	e := testExecutor(t)
	n, err := e.CountCommits(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("empty repo count = %d, want 0", n)
	}
}

func TestCountCommitsAndRecentActivity(t *testing.T) {
	dir := t.TempDir()
	initRepo(t, dir)
	commitFile(t, dir, "a.txt", "a\n", "first")
	commitFile(t, dir, "b.txt", "b\n", "second")

	e := testExecutor(t)
	n, err := e.CountCommits(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("count = %d, want 2", n)
	}

	act, err := e.RecentCommitActivity(context.Background(), dir, 30)
	if err != nil {
		t.Fatal(err)
	}
	if act.TotalCommits != 2 {
		t.Fatalf("total = %d, want 2", act.TotalCommits)
	}
	if act.RecentCommits != 2 {
		t.Fatalf("recent = %d, want 2", act.RecentCommits)
	}
	today := time.Now().Format("2006-01-02")
	if act.ByDay[today] != 2 {
		t.Fatalf("byDay[%s]=%d, want 2; full=%v", today, act.ByDay[today], act.ByDay)
	}
}

func TestRecentActivityIgnoresOldCommits(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip(err)
	}
	dir := t.TempDir()
	initRepo(t, dir)
	e := testExecutor(t)

	if err := os.WriteFile(filepath.Join(dir, "old.txt"), []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Run(context.Background(), RunOpts{
		Repo: dir, Args: []string{"add", "old.txt"}, Write: true,
	}); err != nil {
		t.Fatal(err)
	}
	oldDate := time.Now().AddDate(0, 0, -40).Format("2006-01-02T15:04:05")
	if _, err := e.Run(context.Background(), RunOpts{
		Repo: dir,
		Args: []string{"commit", "-m", "old"},
		Write: true,
		ExtraEnv: []string{
			"GIT_AUTHOR_DATE=" + oldDate,
			"GIT_COMMITTER_DATE=" + oldDate,
		},
	}); err != nil {
		t.Fatal(err)
	}
	commitFile(t, dir, "new.txt", "new\n", "new")

	act, err := e.RecentCommitActivity(context.Background(), dir, 30)
	if err != nil {
		t.Fatal(err)
	}
	if act.TotalCommits != 2 {
		t.Fatalf("total=%d want 2", act.TotalCommits)
	}
	if act.RecentCommits != 1 {
		t.Fatalf("recent=%d want 1; byDay=%v", act.RecentCommits, act.ByDay)
	}
}

func TestDaySeries(t *testing.T) {
	now := time.Date(2026, 7, 11, 15, 0, 0, 0, time.Local)
	days := DaySeries(3, now)
	if len(days) != 3 {
		t.Fatalf("len=%d", len(days))
	}
	if days[0] != "2026-07-09" || days[2] != "2026-07-11" {
		t.Fatalf("unexpected series: %v", days)
	}
}
