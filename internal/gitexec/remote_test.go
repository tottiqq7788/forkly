package gitexec

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestParseGitHubHTTPSURL(t *testing.T) {
	ref, err := ParseGitHubHTTPSURL("https://github.com/octo/hello.git")
	if err != nil {
		t.Fatal(err)
	}
	if ref.Owner != "octo" || ref.Repo != "hello" || ref.URL != "https://github.com/octo/hello.git" {
		t.Fatalf("%+v", ref)
	}
	ref, err = ParseGitHubHTTPSURL("octo/hello")
	if err != nil || ref.Owner != "octo" {
		t.Fatalf("%+v %v", ref, err)
	}
	if _, err := ParseGitHubHTTPSURL("git@github.com:octo/hello.git"); err == nil {
		t.Fatal("ssh should fail")
	}
	if _, err := ParseGitHubHTTPSURL("https://user:token@github.com/octo/hello.git"); err == nil {
		t.Fatal("credential url should fail")
	}
	if _, err := ParseGitHubHTTPSURL("https://gitlab.com/octo/hello.git"); err == nil {
		t.Fatal("non-github should fail")
	}
	if _, err := ParseGitHubHTTPSURL("ext::ssh -o Something"); err == nil {
		t.Fatal("ext should fail")
	}
}

func TestEnsureSafeGitHubRemotePushURL(t *testing.T) {
	rt, err := DiscoverRuntime("")
	if err != nil {
		t.Fatal(err)
	}
	ex := NewExecutor(rt)
	ctx := context.Background()
	root := t.TempDir()
	if err := ex.InitRepo(ctx, root); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.Run(ctx, RunOpts{
		Repo: root, Write: true,
		Args: []string{"remote", "add", "origin", "https://github.com/octo/hello.git"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.EnsureSafeGitHubRemote(ctx, root, "origin"); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.Run(ctx, RunOpts{
		Repo: root, Write: true,
		Args: []string{"remote", "set-url", "--push", "origin", "https://evil.example/steal.git"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.EnsureSafeGitHubRemote(ctx, root, "origin"); err == nil {
		t.Fatal("malicious pushurl should be rejected")
	}
}

func TestAuthGitArgsDisablesCredentialHelper(t *testing.T) {
	got := authGitArgs([]string{"fetch", "origin"})
	if len(got) < 3 || got[0] != "-c" || got[1] != "credential.helper=" || got[2] != "fetch" {
		t.Fatalf("%v", got)
	}
}

func TestRemoteFetchPushFFOnly(t *testing.T) {
	git, err := exec.LookPath("git")
	if err != nil {
		t.Skip("no system git")
	}
	_ = git
	rt, err := DiscoverRuntime("")
	if err != nil {
		t.Fatal(err)
	}
	ex := NewExecutor(rt)
	ctx := context.Background()

	root := t.TempDir()
	bare := filepath.Join(root, "bare.git")
	if err := os.MkdirAll(bare, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.Run(ctx, RunOpts{Repo: bare, Args: []string{"init", "--bare", "-b", "main"}, Write: true}); err != nil {
		t.Fatal(err)
	}

	work := filepath.Join(root, "work")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := ex.InitRepo(ctx, work); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(work, "a.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.Run(ctx, RunOpts{
		Repo: work, Write: true,
		Args: []string{"add", "a.txt"},
		ExtraEnv: []string{"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@e.com", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@e.com"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.Run(ctx, RunOpts{
		Repo: work, Write: true,
		Args: []string{"-c", "user.name=t", "-c", "user.email=t@e.com", "commit", "-m", "init"},
	}); err != nil {
		t.Fatal(err)
	}

	// Use file:// bare remote — ParseGitHubHTTPSURL would reject; for unit
	// tests we call git remote add directly.
	bareURL := "file://" + bare
	if _, err := ex.Run(ctx, RunOpts{
		Repo: work, Write: true,
		Args: []string{"remote", "add", "origin", bareURL},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.Run(ctx, RunOpts{
		Repo: work, Write: true,
		Args: []string{"push", "-u", "origin", "main"},
		Timeout: 60 * time.Second,
	}); err != nil {
		t.Fatal(err)
	}

	work2 := filepath.Join(root, "work2")
	if _, err := ex.Run(ctx, RunOpts{
		Args: []string{"clone", bareURL, work2}, Write: true, Repo: root, Timeout: 60 * time.Second,
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(work2, "b.txt"), []byte("two\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.Run(ctx, RunOpts{Repo: work2, Write: true, Args: []string{"add", "b.txt"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.Run(ctx, RunOpts{
		Repo: work2, Write: true,
		Args: []string{"-c", "user.name=t", "-c", "user.email=t@e.com", "commit", "-m", "second"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.Run(ctx, RunOpts{
		Repo: work2, Write: true, Args: []string{"push", "origin", "main"}, Timeout: 60 * time.Second,
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := ex.Run(ctx, RunOpts{
		Repo: work, Write: true, Args: []string{"fetch", "origin"}, Timeout: 60 * time.Second,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.Run(ctx, RunOpts{
		Repo: work, Write: true, Args: []string{"merge", "--ff-only", "origin/main"}, Timeout: 60 * time.Second,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(work, "b.txt")); err != nil {
		t.Fatal("ff-only pull failed to bring file")
	}
}

func TestParseRemoteV(t *testing.T) {
	list := parseRemoteV("origin\thttps://github.com/a/b.git (fetch)\norigin\thttps://github.com/a/b.git (push)\n")
	if len(list) != 1 || list[0].Name != "origin" {
		t.Fatalf("%+v", list)
	}
}
