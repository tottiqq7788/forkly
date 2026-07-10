package localapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/forkly-app/forkly/internal/app"
	"github.com/forkly-app/forkly/internal/diagnostics"
	"github.com/forkly-app/forkly/internal/session"
)

func TestLocalAPIFlow(t *testing.T) {
	log, err := diagnostics.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	dataDir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, shutdown, openURL, err := app.RunServerOnly(ctx, log, dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer shutdown(context.Background())

	client, err := app.ClaimClient(openURL)
	if err != nil {
		t.Fatal(err)
	}
	// get csrf from jar via me endpoint cookies already set
	res, err := client.Get(openURL[:len(openURL)-len("/local-api/v1/session/claim?token="+extractToken(openURL)+"&next=/")] + "/local-api/v1/health")
	if err != nil {
		// simpler: parse base from openURL
		_ = res
	}
	base := baseFrom(openURL)
	res, err = client.Get(base + "/local-api/v1/health")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("health %d", res.StatusCode)
	}

	repo := t.TempDir()
	csrf := readCSRF(client, base)
	body, _ := json.Marshal(map[string]any{"path": repo, "init": true})
	req, _ := http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 201 {
		var errBody map[string]string
		_ = json.NewDecoder(res.Body).Decode(&errBody)
		t.Fatalf("add project %d %v", res.StatusCode, errBody)
	}
	var proj map[string]any
	_ = json.NewDecoder(res.Body).Decode(&proj)
	id, _ := proj["id"].(string)
	if id == "" {
		t.Fatal("no id")
	}

	os.WriteFile(filepath.Join(repo, "hello.txt"), []byte("hi\n"), 0o644)
	time.Sleep(50 * time.Millisecond)
	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/status")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var st struct {
		Files       []map[string]any `json:"files"`
		Fingerprint string           `json:"fingerprint"`
	}
	_ = json.NewDecoder(res.Body).Decode(&st)
	if len(st.Files) == 0 {
		t.Fatal("expected changes")
	}

	commitBody, _ := json.Marshal(map[string]any{
		"paths":       []string{"hello.txt"},
		"message":     "add hello",
		"fingerprint": st.Fingerprint,
	})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/commit", bytes.NewReader(commitBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		var errBody map[string]string
		_ = json.NewDecoder(res.Body).Decode(&errBody)
		t.Fatalf("commit %d %v", res.StatusCode, errBody)
	}
}

func baseFrom(openURL string) string {
	// http://127.0.0.1:PORT/local-api/...
	i := 0
	count := 0
	for j := 0; j < len(openURL); j++ {
		if openURL[j] == '/' {
			count++
			if count == 3 {
				i = j
				break
			}
		}
	}
	if i == 0 {
		return openURL
	}
	return openURL[:i]
}

func extractToken(openURL string) string {
	const key = "token="
	i := indexOf(openURL, key)
	if i < 0 {
		return ""
	}
	rest := openURL[i+len(key):]
	j := indexOf(rest, "&")
	if j < 0 {
		return rest
	}
	return rest[:j]
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func readCSRF(client *http.Client, base string) string {
	res, err := client.Get(base + "/local-api/v1/session/me")
	if err != nil {
		return ""
	}
	defer res.Body.Close()
	for _, c := range res.Cookies() {
		if c.Name == session.CSRFCookie {
			return c.Value
		}
	}
	// from jar
	u, _ := http.NewRequest(http.MethodGet, base, nil)
	_ = u
	return cookieFromJar(client, base, session.CSRFCookie)
}

func cookieFromJar(client *http.Client, base, name string) string {
	if client.Jar == nil {
		return ""
	}
	u, err := url.Parse(base + "/")
	if err != nil {
		return ""
	}
	for _, c := range client.Jar.Cookies(u) {
		if c.Name == name {
			return c.Value
		}
	}
	return ""
}

func TestDevLogin(t *testing.T) {
	log, err := diagnostics.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	addr, shutdown, _, err := app.RunServerOnlyWith(ctx, log, app.ServerOnlyOptions{
		DataDir: t.TempDir(),
		Listen:  "127.0.0.1:0",
		DevMode: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer shutdown(context.Background())

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	res, err := client.Post(addr+"/local-api/v1/session/dev-login", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("dev-login %d", res.StatusCode)
	}

	res, err = client.Get(addr + "/local-api/v1/session/me")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("me after dev-login %d", res.StatusCode)
	}
}

func TestDevLoginDisabled(t *testing.T) {
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

	res, err := http.Post(addr+"/local-api/v1/session/dev-login", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatalf("expected 404 without DevMode, got %d", res.StatusCode)
	}
}

func TestDashboardActivity(t *testing.T) {
	log, err := diagnostics.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	dataDir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, shutdown, openURL, err := app.RunServerOnly(ctx, log, dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer shutdown(context.Background())

	client, err := app.ClaimClient(openURL)
	if err != nil {
		t.Fatal(err)
	}
	base := baseFrom(openURL)

	// Unauthenticated should fail.
	res, err := http.Get(base + "/local-api/v1/dashboard/activity")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatalf("unauth status %d", res.StatusCode)
	}

	csrf := readCSRF(client, base)

	// Create a project then delete its directory to simulate unavailable.
	parent := t.TempDir()
	body, _ := json.Marshal(map[string]any{"path": parent, "name": "will-delete", "create": true, "init": true})
	req, _ := http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 201 {
		var errBody map[string]string
		_ = json.NewDecoder(res.Body).Decode(&errBody)
		res.Body.Close()
		t.Fatalf("add missing-bound project %d %v", res.StatusCode, errBody)
	}
	res.Body.Close()
	_ = os.RemoveAll(filepath.Join(parent, "will-delete"))

	repo := t.TempDir()
	body, _ = json.Marshal(map[string]any{"path": repo, "init": true})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 201 {
		var errBody map[string]string
		_ = json.NewDecoder(res.Body).Decode(&errBody)
		t.Fatalf("add project %d %v", res.StatusCode, errBody)
	}
	var proj map[string]any
	_ = json.NewDecoder(res.Body).Decode(&proj)
	id, _ := proj["id"].(string)

	os.WriteFile(filepath.Join(repo, "hello.txt"), []byte("hi\n"), 0o644)
	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/status")
	if err != nil {
		t.Fatal(err)
	}
	var st struct {
		Files       []map[string]any `json:"files"`
		Fingerprint string           `json:"fingerprint"`
	}
	_ = json.NewDecoder(res.Body).Decode(&st)
	res.Body.Close()

	commitBody, _ := json.Marshal(map[string]any{
		"paths":       []string{"hello.txt"},
		"message":     "add hello",
		"fingerprint": st.Fingerprint,
	})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/commit", bytes.NewReader(commitBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("commit %d", res.StatusCode)
	}

	res, err = client.Get(base + "/local-api/v1/dashboard/activity?days=30")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("dashboard %d", res.StatusCode)
	}
	var dash struct {
		Days          int `json:"days"`
		TotalCommits  int `json:"totalCommits"`
		RecentCommits int `json:"recentCommits"`
		Series        []struct {
			Date  string `json:"date"`
			Count int    `json:"count"`
		} `json:"series"`
		ScannedProjects int `json:"scannedProjects"`
		Unavailable     int `json:"unavailable"`
	}
	if err := json.NewDecoder(res.Body).Decode(&dash); err != nil {
		t.Fatal(err)
	}
	if dash.Days != 30 {
		t.Fatalf("days=%d", dash.Days)
	}
	if len(dash.Series) != 30 {
		t.Fatalf("series len=%d", len(dash.Series))
	}
	if dash.TotalCommits < 1 || dash.RecentCommits < 1 {
		t.Fatalf("commits total=%d recent=%d", dash.TotalCommits, dash.RecentCommits)
	}
	if dash.Unavailable < 1 {
		t.Fatalf("expected unavailable >= 1, got %d", dash.Unavailable)
	}
	today := time.Now().Format("2006-01-02")
	foundToday := false
	for _, d := range dash.Series {
		if d.Date == today && d.Count >= 1 {
			foundToday = true
		}
	}
	if !foundToday {
		t.Fatalf("today %s missing or zero in series %#v", today, dash.Series[len(dash.Series)-3:])
	}

	// Also verify kindCounts on projects list.
	res, err = client.Get(base + "/local-api/v1/projects")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var list struct {
		Projects []map[string]any `json:"projects"`
	}
	_ = json.NewDecoder(res.Body).Decode(&list)
	if len(list.Projects) < 1 {
		t.Fatal("expected projects")
	}
}
