package localapi_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/forkly-app/forkly/internal/app"
	"github.com/forkly-app/forkly/internal/diagnostics"
)

func TestClaimExpiredRedirectsToHome(t *testing.T) {
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

	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	res, err := client.Get(addr + "/local-api/v1/session/claim?token=not-a-real-token&next=/editor/local/x")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusFound {
		t.Fatalf("status=%d want 302", res.StatusCode)
	}
	loc := res.Header.Get("Location")
	if loc != "/?claim=expired" {
		t.Fatalf("location=%q want /?claim=expired", loc)
	}
}
