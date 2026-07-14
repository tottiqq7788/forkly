package github_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/forkly-app/forkly/internal/credentials"
	gh "github.com/forkly-app/forkly/internal/github"
)

func TestSetPATAndGetUser(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/user" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(401)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "bad creds"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"login": "octocat", "id": 1, "name": "Octo", "avatar_url": "https://example/a.png",
		})
	}))
	defer srv.Close()

	creds := credentials.NewMemoryStore()
	c := gh.NewClient(creds)
	c.APIBase = srv.URL
	c.HTTP = srv.Client()

	user, accountID, err := c.SetPAT(context.Background(), "test-token")
	if err != nil {
		t.Fatal(err)
	}
	if user.Login != "octocat" || accountID != "gh_1" {
		t.Fatalf("%+v %s", user, accountID)
	}
	secret, err := creds.Get(accountID)
	if err != nil || secret.Token != "test-token" {
		t.Fatalf("%+v %v", secret, err)
	}
}

func TestStartDeviceFlowRequiresClientID(t *testing.T) {
	c := gh.NewClient(credentials.NewMemoryStore())
	c.ClientID = ""
	_, err := c.StartDeviceFlow(context.Background())
	if err == nil {
		t.Fatal("expected config missing")
	}
	var apiErr *gh.APIError
	if !gh.AsAPIError(err, &apiErr) || apiErr.Code != gh.CodeConfigMissing {
		t.Fatalf("%v", err)
	}
}

func TestStartDeviceFlowReturnsUserCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login/device/code" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code": "dc", "user_code": "ABCD-EFGH",
				"verification_uri": "https://github.com/login/device",
				"expires_in": 900, "interval": 5,
			})
			return
		}
		// Keep poll from completing / failing the test noisily.
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "authorization_pending"})
	}))
	defer srv.Close()

	c := gh.NewClient(credentials.NewMemoryStore())
	c.ClientID = "client"
	c.LoginBase = srv.URL
	c.APIBase = srv.URL
	c.HTTP = srv.Client()

	start, err := c.StartDeviceFlow(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if start.UserCode != "ABCD-EFGH" || start.FlowID == "" {
		t.Fatalf("%+v", start)
	}
	st, err := c.DeviceStatus(start.FlowID)
	if err != nil {
		t.Fatal(err)
	}
	if st.Status != "pending" {
		t.Fatalf("%+v", st)
	}
	c.CancelDeviceFlow(start.FlowID)
	time.Sleep(20 * time.Millisecond)
}
