package localapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/forkly-app/forkly/internal/app"
	"github.com/forkly-app/forkly/internal/diagnostics"
)

func TestCSRFRejected(t *testing.T) {
	log, err := diagnostics.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, shutdown, openURL, err := app.RunServerOnly(ctx, log, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer shutdown(context.Background())
	client, err := app.ClaimClient(openURL)
	if err != nil {
		t.Fatal(err)
	}
	base := baseFrom(openURL)
	req, _ := http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader([]byte(`{"path":"/tmp","init":true}`)))
	req.Header.Set("Content-Type", "application/json")
	// no CSRF header
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", res.StatusCode)
	}

	csrf := readCSRF(client, base)
	repo := t.TempDir()
	body, _ := json.Marshal(map[string]any{"path": repo, "init": true})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forkly-CSRF", csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var proj map[string]any
	_ = json.NewDecoder(res.Body).Decode(&proj)
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("add project %d", res.StatusCode)
	}
	id, _ := proj["id"].(string)

	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/branches/switch", bytes.NewReader([]byte(`{"name":"main"}`)))
	req.Header.Set("Content-Type", "application/json")
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("branch switch without CSRF expected 403, got %d", res.StatusCode)
	}
}

func TestForbiddenHostPrefixBypass(t *testing.T) {
	log, err := diagnostics.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	addr, shutdown, _, err := app.RunServerOnly(ctx, log, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer shutdown(context.Background())

	req, err := http.NewRequest(http.MethodGet, addr+"/local-api/v1/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "127.0.0.1.evil"
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for prefix-bypass host, got %d", res.StatusCode)
	}
}

func TestCrossOriginWriteBlocked(t *testing.T) {
	log, err := diagnostics.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, shutdown, openURL, err := app.RunServerOnly(ctx, log, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer shutdown(context.Background())
	base := baseFrom(openURL)
	req, _ := http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK || res.StatusCode == http.StatusCreated {
		t.Fatalf("cross-origin write should be blocked, got %d", res.StatusCode)
	}
}

func TestProjectRevealRequiresCSRF(t *testing.T) {
	log, err := diagnostics.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, shutdown, openURL, err := app.RunServerOnly(ctx, log, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer shutdown(context.Background())
	client, err := app.ClaimClient(openURL)
	if err != nil {
		t.Fatal(err)
	}
	base := baseFrom(openURL)
	csrf := readCSRF(client, base)

	repo := t.TempDir()
	body := []byte(`{"path":` + mustJSONString(repo) + `,"init":true}`)
	req, _ := http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forkly-CSRF", csrf)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var proj map[string]any
	_ = json.NewDecoder(res.Body).Decode(&proj)
	res.Body.Close()
	id, _ := proj["id"].(string)
	if id == "" {
		t.Fatal("no project id")
	}

	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/reveal", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "application/json")
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 without CSRF, got %d", res.StatusCode)
	}
}

func mustJSONString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestSecurityHeadersAllowHttpsImages(t *testing.T) {
	log, err := diagnostics.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	addr, shutdown, _, err := app.RunServerOnly(ctx, log, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer shutdown(context.Background())

	req, err := http.NewRequest(http.MethodGet, addr+"/local-api/v1/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "127.0.0.1"
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	csp := res.Header.Get("Content-Security-Policy")
	if !strings.Contains(csp, "img-src 'self' data: blob: https:") {
		t.Fatalf("expected https in img-src, got %q", csp)
	}
	if !strings.Contains(csp, "font-src 'self' data:") {
		t.Fatalf("expected font-src to allow data: fonts, got %q", csp)
	}
	if !strings.Contains(csp, "script-src 'self'") || strings.Contains(csp, "unsafe-eval") {
		t.Fatalf("script-src must stay self without unsafe-eval: %q", csp)
	}
	if !strings.Contains(csp, "connect-src 'self'") {
		t.Fatalf("connect-src must include self: %q", csp)
	}
	// Ensure we did not open remote script/connect.
	if strings.Contains(csp, "script-src 'self' https:") || strings.Contains(csp, "connect-src 'self' https:") {
		t.Fatalf("must not allow remote script/connect: %q", csp)
	}
}
