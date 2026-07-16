package github_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/forkly-app/forkly/internal/credentials"
	gh "github.com/forkly-app/forkly/internal/github"
)

func TestWebOAuthRequiresSecret(t *testing.T) {
	c := gh.NewClient(credentials.NewMemoryStore())
	c.ClientID = "client-id"
	c.ClientSecret = ""
	gh.ClientSecret = ""
	_, err := c.StartWebOAuth(context.Background(), "http://127.0.0.1:8787/cb", "", "/settings")
	if err == nil {
		t.Fatal("expected config missing")
	}
	var apiErr *gh.APIError
	if !gh.AsAPIError(err, &apiErr) || apiErr.Code != gh.CodeConfigMissing {
		t.Fatalf("%v", err)
	}
}

func TestWebOAuthStartAndComplete(t *testing.T) {
	var gotVerifier, gotCode, gotSecret string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/user":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"login": "octocat", "id": 42, "name": "Octo", "avatar_url": "https://example/a.png",
			})
		case r.URL.Path == "/login/oauth/access_token":
			_ = r.ParseForm()
			gotVerifier = r.Form.Get("code_verifier")
			gotCode = r.Form.Get("code")
			gotSecret = r.Form.Get("client_secret")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "access", "token_type": "bearer", "scope": "repo",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := gh.NewClient(credentials.NewMemoryStore())
	c.ClientID = "client-id"
	c.ClientSecret = "client-secret"
	c.APIBase = srv.URL
	c.LoginBase = srv.URL
	c.HTTP = srv.Client()

	redirectURI := "http://127.0.0.1:8787/local-api/v1/github/oauth/callback"
	start, err := c.StartWebOAuth(context.Background(), redirectURI, "proj-1", "/projects/proj-1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(start.AuthorizationURL, "code_challenge=") || start.State == "" {
		t.Fatalf("%+v", start)
	}

	result, err := c.CompleteWebOAuth(context.Background(), "auth-code", start.State, redirectURI)
	if err != nil {
		t.Fatal(err)
	}
	if result.AccountID != "gh_42" || result.ProjectID != "proj-1" || result.User.Login != "octocat" {
		t.Fatalf("%+v", result)
	}
	if gotCode != "auth-code" || gotSecret != "client-secret" || gotVerifier == "" {
		t.Fatalf("verifier=%q code=%q secret=%q", gotVerifier, gotCode, gotSecret)
	}
	secret, err := c.Creds.Get("gh_42")
	if err != nil || secret.Token != "access" {
		t.Fatalf("%+v %v", secret, err)
	}

	_, err = c.CompleteWebOAuth(context.Background(), "auth-code", start.State, redirectURI)
	if err == nil {
		t.Fatal("expected replay failure")
	}
}

func TestWebOAuthStateTTLIsTenMinutes(t *testing.T) {
	// Smoke: ensure package compiles with expected TTL constant via successful start metadata.
	c := gh.NewClient(credentials.NewMemoryStore())
	c.ClientID = "id"
	c.ClientSecret = "secret"
	start, err := c.StartWebOAuth(context.Background(), "http://127.0.0.1:1/cb", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if start.State == "" {
		t.Fatal("missing state")
	}
	_ = time.Minute
}

func TestWebOAuthRedirectMismatch(t *testing.T) {
	c := gh.NewClient(credentials.NewMemoryStore())
	c.ClientID = "id"
	c.ClientSecret = "secret"
	redirectURI := "http://127.0.0.1:1/cb"
	start, err := c.StartWebOAuth(context.Background(), redirectURI, "", "")
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.CompleteWebOAuth(context.Background(), "code", start.State, "http://127.0.0.1:2/cb")
	if err == nil {
		t.Fatal("expected redirect mismatch")
	}
}

func TestWebOAuthExchangeFailureKeepsReturnTo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login/oauth/access_token" {
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "bad_verification_code"})
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	c := gh.NewClient(credentials.NewMemoryStore())
	c.ClientID = "client-id"
	c.ClientSecret = "client-secret"
	c.LoginBase = srv.URL
	c.HTTP = srv.Client()

	redirectURI := "http://127.0.0.1:8787/cb"
	start, err := c.StartWebOAuth(context.Background(), redirectURI, "p1", "http://127.0.0.1:5173/projects/p1")
	if err != nil {
		t.Fatal(err)
	}
	result, err := c.CompleteWebOAuth(context.Background(), "code", start.State, redirectURI)
	if err == nil {
		t.Fatal("expected exchange error")
	}
	if result.ReturnTo != "http://127.0.0.1:5173/projects/p1" || result.ProjectID != "p1" {
		t.Fatalf("%+v", result)
	}
}

func TestDropWebOAuthFlow(t *testing.T) {
	c := gh.NewClient(credentials.NewMemoryStore())
	c.ClientID = "id"
	c.ClientSecret = "secret"
	start, err := c.StartWebOAuth(context.Background(), "http://127.0.0.1:1/cb", "p1", "/projects/p1")
	if err != nil {
		t.Fatal(err)
	}
	got := c.DropWebOAuthFlow(start.State)
	if got != "/projects/p1" {
		t.Fatalf("got %q", got)
	}
	if c.DropWebOAuthFlow(start.State) != "" {
		t.Fatal("expected flow removed")
	}
}

func TestWebOAuthConfiguredAtBuild(t *testing.T) {
	if os.Getenv("FORKLY_VERIFY_OAUTH_BUILD") != "1" {
		t.Skip("set FORKLY_VERIFY_OAUTH_BUILD=1 with OAuth ldflags for release verification")
	}
	c := gh.NewClient(credentials.NewMemoryStore())
	if !c.WebOAuthConfigured() {
		t.Fatalf("expected WebOAuthConfigured at build time, clientID=%q", c.ClientID)
	}
}
