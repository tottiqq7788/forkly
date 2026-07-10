package localapi_test

import (
	"bytes"
	"context"
	"net/http"
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
