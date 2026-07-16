package localapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/credentials"
	"github.com/forkly-app/forkly/internal/diagnostics"
	gh "github.com/forkly-app/forkly/internal/github"
	"github.com/forkly-app/forkly/internal/session"
)

func TestValidateOAuthReturnToDevTrusted(t *testing.T) {
	s := &Server{
		deps: Deps{DevMode: true},
		addr: "http://127.0.0.1:8787",
	}
	got, err := s.validateOAuthReturnTo("/projects/p1?drawer=settings")
	if err != nil || got != "http://127.0.0.1:5173/projects/p1?drawer=settings" {
		t.Fatalf("%q %v", got, err)
	}
	full, err := s.validateOAuthReturnTo("http://127.0.0.1:5173/projects/p1")
	if err != nil || full != "http://127.0.0.1:5173/projects/p1" {
		t.Fatalf("%q %v", full, err)
	}
	withQuery, err := s.validateOAuthReturnTo("http://127.0.0.1:5173/projects/p1?drawer=settings")
	if err != nil || withQuery != "http://127.0.0.1:5173/projects/p1?drawer=settings" {
		t.Fatalf("%q %v", withQuery, err)
	}
	if _, err := s.validateOAuthReturnTo("https://evil.example/steal"); err == nil {
		t.Fatal("expected reject external origin")
	}
	if _, err := s.validateOAuthReturnTo("//evil.example"); err == nil {
		t.Fatal("expected reject protocol-relative path")
	}
}

func TestAppendOAuthResultParams(t *testing.T) {
	got := appendOAuthResultParams("http://127.0.0.1:5173/projects/p1", "ok", "linked", "完成", true)
	for _, part := range []string{"gh_oauth=ok", "gh_link=linked", "gh_fetch=1", "gh_msg="} {
		if !strings.Contains(got, part) {
			t.Fatalf("%s missing %s", got, part)
		}
	}
}

func TestOAuthCallbackRejectsMissingCode(t *testing.T) {
	log, err := diagnostics.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	store, err := config.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	srv := New(Deps{
		Log:      log,
		Store:    store,
		Sessions: session.NewManager(24 * time.Hour),
		GitHub:   gh.NewClient(credentials.NewMemoryStore()),
		DevMode:  true,
	})
	addr, err := srv.StartWith(StartOptions{Listen: "127.0.0.1:0"})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", addr+"/local-api/v1/github/oauth/callback?state=x", nil)
	rec := httptest.NewRecorder()
	srv.handleGitHubOAuthCallback(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if loc == "" || !strings.Contains(loc, "gh_oauth=error") {
		t.Fatalf("location %q", loc)
	}
}
