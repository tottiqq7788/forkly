package localapi_test

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/forkly-app/forkly/internal/app"
	"github.com/forkly-app/forkly/internal/diagnostics"
)

func TestSPAHistoryFallback(t *testing.T) {
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

	assertHTML := func(t *testing.T, path string) {
		t.Helper()
		res, err := http.Get(addr + path)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("%s status=%d body=%q", path, res.StatusCode, body)
		}
		if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "text/html") {
			t.Fatalf("%s content-type=%q", path, ct)
		}
		if !strings.Contains(string(body), "<div id=\"root\">") {
			t.Fatalf("%s missing SPA root: %q", path, truncate(string(body), 200))
		}
		if cc := res.Header.Get("Cache-Control"); cc != "no-store" {
			t.Fatalf("%s cache-control=%q want no-store", path, cc)
		}
	}

	assertNotFound := func(t *testing.T, path string) {
		t.Helper()
		res, err := http.Get(addr + path)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("%s status=%d want 404", path, res.StatusCode)
		}
	}

	assertHTML(t, "/editor/local/laOMUYgLKN3k7lgdowTrDQ")
	assertHTML(t, "/projects/abc")
	assertNotFound(t, "/assets/missing.js")
	assertNotFound(t, "/local-api/v1/nope")
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
