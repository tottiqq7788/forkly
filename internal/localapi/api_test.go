package localapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/forkly-app/forkly/internal/app"
	"github.com/forkly-app/forkly/internal/config"
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
	identBody, _ := json.Marshal(map[string]any{
		"identity": map[string]string{"name": "Test User", "email": "test@example.com"},
	})
	req, _ := http.NewRequest(http.MethodPut, base+"/local-api/v1/settings", bytes.NewReader(identBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("settings identity %d", res.StatusCode)
	}

	body, _ := json.Marshal(map[string]any{"path": repo, "init": true})
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

func TestProjectEntriesAPI(t *testing.T) {
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
	csrf := readCSRF(client, base)
	repo := t.TempDir()

	body, _ := json.Marshal(map[string]any{"path": repo, "init": true})
	req, _ := http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var proj map[string]any
	_ = json.NewDecoder(res.Body).Decode(&proj)
	res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("add project %d", res.StatusCode)
	}
	id, _ := proj["id"].(string)

	body, _ = json.Marshal(map[string]any{"kind": "dir", "parentPath": "", "name": "docs"})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/entries", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create dir %d", res.StatusCode)
	}

	body, _ = json.Marshal(map[string]any{"kind": "file", "parentPath": "docs", "name": "note.md"})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/entries", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var createRes struct {
		Entry map[string]any `json:"entry"`
	}
	_ = json.NewDecoder(res.Body).Decode(&createRes)
	res.Body.Close()
	if res.StatusCode != http.StatusCreated || createRes.Entry["path"] != "docs/note.md" {
		t.Fatalf("create file %d %#v", res.StatusCode, createRes)
	}

	body, _ = json.Marshal(map[string]any{"path": "docs/note.md", "name": "renamed.md"})
	req, _ = http.NewRequest(http.MethodPatch, base+"/local-api/v1/projects/"+id+"/entries", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("rename file %d", res.StatusCode)
	}

	body, _ = json.Marshal(map[string]any{"path": "../outside"})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/reveal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("reveal escape should be 400, got %d", res.StatusCode)
	}

	body, _ = json.Marshal(map[string]any{"path": "docs/renamed.md"})
	req, _ = http.NewRequest(http.MethodDelete, base+"/local-api/v1/projects/"+id+"/entries", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("delete file %d", res.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(repo, "docs", "renamed.md")); !os.IsNotExist(err) {
		t.Fatalf("expected file deleted, err=%v", err)
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

func TestDevModeAutoSessionAfterStaleCookie(t *testing.T) {
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

	req, _ := http.NewRequest(http.MethodGet, addr+"/local-api/v1/session/me", nil)
	req.AddCookie(&http.Cookie{Name: session.CookieName, Value: "stale-session-id-after-restart"})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("expected auto session in DevMode, got %d", res.StatusCode)
	}
	foundSession := false
	for _, c := range res.Cookies() {
		if c.Name == session.CookieName && c.Value != "" && c.Value != "stale-session-id-after-restart" {
			foundSession = true
		}
	}
	if !foundSession {
		t.Fatal("expected Set-Cookie with new forkly_session")
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

	identBody, _ := json.Marshal(map[string]any{
		"identity": map[string]string{"name": "Dash User", "email": "dash@example.com"},
	})
	req, _ := http.NewRequest(http.MethodPut, base+"/local-api/v1/settings", bytes.NewReader(identBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("settings identity %d", res.StatusCode)
	}

	// Create a project then delete its directory to simulate unavailable.
	parent := t.TempDir()
	body, _ := json.Marshal(map[string]any{"path": parent, "name": "will-delete", "create": true, "init": true})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader(body))
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

func TestProjectLifecycleAndIdentity(t *testing.T) {
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
	csrf := readCSRF(client, base)

	// Default identity is not configured.
	res, err := client.Get(base + "/local-api/v1/session/me")
	if err != nil {
		t.Fatal(err)
	}
	var me struct {
		IdentityConfigured bool `json:"identityConfigured"`
	}
	_ = json.NewDecoder(res.Body).Decode(&me)
	res.Body.Close()
	if me.IdentityConfigured {
		t.Fatal("default identity should not be configured")
	}

	body, _ := json.Marshal(map[string]any{
		"identity": map[string]string{"name": "Alice", "email": "alice@example.com"},
	})
	req, _ := http.NewRequest(http.MethodPut, base+"/local-api/v1/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("settings %d", res.StatusCode)
	}
	res, err = client.Get(base + "/local-api/v1/session/me")
	if err != nil {
		t.Fatal(err)
	}
	_ = json.NewDecoder(res.Body).Decode(&me)
	res.Body.Close()
	if !me.IdentityConfigured {
		t.Fatal("expected identityConfigured after settings")
	}

	// Empty identity must be rejected.
	emptyIdent, _ := json.Marshal(map[string]any{
		"identity": map[string]string{"name": "  ", "email": ""},
	})
	req, _ = http.NewRequest(http.MethodPut, base+"/local-api/v1/settings", bytes.NewReader(emptyIdent))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatalf("empty identity should be 400, got %d", res.StatusCode)
	}

	repo := t.TempDir()
	body, _ = json.Marshal(map[string]any{"path": repo, "init": true})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var proj map[string]any
	_ = json.NewDecoder(res.Body).Decode(&proj)
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("add %d", res.StatusCode)
	}
	id, _ := proj["id"].(string)

	// Reset to placeholder and ensure commit is rejected.
	placeholder, _ := json.Marshal(map[string]any{
		"identity": map[string]string{
			"name":  config.DefaultIdentityName,
			"email": config.DefaultIdentityEmail,
		},
	})
	req, _ = http.NewRequest(http.MethodPut, base+"/local-api/v1/settings", bytes.NewReader(placeholder))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("reset placeholder %d", res.StatusCode)
	}
	os.WriteFile(filepath.Join(repo, "blocked.txt"), []byte("x\n"), 0o644)
	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/status")
	if err != nil {
		t.Fatal(err)
	}
	var blockedSt struct {
		Fingerprint string `json:"fingerprint"`
	}
	_ = json.NewDecoder(res.Body).Decode(&blockedSt)
	res.Body.Close()
	blockedCommit, _ := json.Marshal(map[string]any{
		"paths":       []string{"blocked.txt"},
		"message":     "should fail",
		"fingerprint": blockedSt.Fingerprint,
	})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/commit", bytes.NewReader(blockedCommit))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatalf("commit without identity should be 400, got %d", res.StatusCode)
	}

	// Restore real identity for remaining lifecycle checks.
	body, _ = json.Marshal(map[string]any{
		"identity": map[string]string{"name": "Alice", "email": "alice@example.com"},
	})
	req, _ = http.NewRequest(http.MethodPut, base+"/local-api/v1/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("restore identity %d", res.StatusCode)
	}

	// Legacy global reveal route must be gone.
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/reveal", bytes.NewReader([]byte(`{"path":"/tmp"}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatalf("legacy reveal should be 404, got %d", res.StatusCode)
	}

	// Unauthenticated project reveal.
	res, err = http.Post(base+"/local-api/v1/projects/"+id+"/reveal", "application/json", bytes.NewReader([]byte("{}")))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatalf("unauth reveal %d", res.StatusCode)
	}

	// Authenticated reveal without platform Reveal returns 501 in server-only mode.
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/reveal", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotImplemented {
		t.Fatalf("reveal without platform support: %d", res.StatusCode)
	}

	// Relocate to a new git repo path.
	newRepo := t.TempDir()
	body, _ = json.Marshal(map[string]any{"path": newRepo, "init": true})
	// init via add would register duplicate; init manually with git through relocate requirement
	// Relocate requires existing git repo — create by temporarily adding then removing, or use project.Init via API.
	// Simpler: write files and use second add with init, then remove second from list... messy.
	// Use relocate onto a fresh inited folder created via filesystem + inspect isn't enough.
	// Create via POST projects then DELETE leaving the git dir, then relocate first project there?
	// Actually: init newRepo by adding as project then deleting registration.
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var proj2 map[string]any
	_ = json.NewDecoder(res.Body).Decode(&proj2)
	res.Body.Close()
	id2, _ := proj2["id"].(string)
	if res.StatusCode != 201 || id2 == "" {
		t.Fatalf("add newRepo %d", res.StatusCode)
	}
	req, _ = http.NewRequest(http.MethodDelete, base+"/local-api/v1/projects/"+id2, nil)
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("delete temp project %d", res.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(newRepo, ".git")); err != nil {
		t.Fatalf("git dir should remain after remove: %v", err)
	}

	body, _ = json.Marshal(map[string]any{"path": newRepo})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/relocate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("relocate %d", res.StatusCode)
	}

	// Relocate onto another registered project's path must fail.
	otherRepo := t.TempDir()
	body, _ = json.Marshal(map[string]any{"path": otherRepo, "init": true})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var otherProj map[string]any
	_ = json.NewDecoder(res.Body).Decode(&otherProj)
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("add other project %d", res.StatusCode)
	}
	otherID, _ := otherProj["id"].(string)
	body, _ = json.Marshal(map[string]any{"path": otherRepo})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/relocate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatalf("duplicate relocate should be 400, got %d", res.StatusCode)
	}
	req, _ = http.NewRequest(http.MethodDelete, base+"/local-api/v1/projects/"+otherID, nil)
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/status")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 200 {
		res.Body.Close()
		t.Fatalf("status after relocate %d", res.StatusCode)
	}
	res.Body.Close()

	// Remove original registration; disk repo remains.
	marker := filepath.Join(newRepo, "keep.txt")
	_ = os.WriteFile(marker, []byte("x"), 0o644)
	req, _ = http.NewRequest(http.MethodDelete, base+"/local-api/v1/projects/"+id, nil)
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("remove %d", res.StatusCode)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("disk files should remain: %v", err)
	}
	if _, err := os.Stat(filepath.Join(newRepo, ".git")); err != nil {
		t.Fatalf(".git should remain: %v", err)
	}
}

func TestBrowseTreeAndContentAPI(t *testing.T) {
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
	csrf := readCSRF(client, base)

	repo := t.TempDir()
	body, _ := json.Marshal(map[string]any{"path": repo, "init": true})
	req, _ := http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var proj map[string]any
	_ = json.NewDecoder(res.Body).Decode(&proj)
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("add %d", res.StatusCode)
	}
	id, _ := proj["id"].(string)

	// Empty HEAD
	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/tree?source=head")
	if err != nil {
		t.Fatal(err)
	}
	var emptyHead struct {
		EmptyHead bool `json:"emptyHead"`
	}
	_ = json.NewDecoder(res.Body).Decode(&emptyHead)
	res.Body.Close()
	if res.StatusCode != 200 || !emptyHead.EmptyHead {
		t.Fatalf("empty head: status=%d empty=%v", res.StatusCode, emptyHead.EmptyHead)
	}

	// Unauthenticated
	res, err = http.Get(base + "/local-api/v1/projects/" + id + "/tree")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatalf("unauth tree %d", res.StatusCode)
	}

	if err := os.WriteFile(filepath.Join(repo, "hello.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	identBody, _ := json.Marshal(map[string]any{
		"identity": map[string]string{"name": "Browse User", "email": "browse@example.com"},
	})
	req, _ = http.NewRequest(http.MethodPut, base+"/local-api/v1/settings", bytes.NewReader(identBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	stRes, err := client.Get(base + "/local-api/v1/projects/" + id + "/status")
	if err != nil {
		t.Fatal(err)
	}
	var st struct {
		Fingerprint string `json:"fingerprint"`
	}
	_ = json.NewDecoder(stRes.Body).Decode(&st)
	stRes.Body.Close()
	commitBody, _ := json.Marshal(map[string]any{
		"paths": []string{"hello.txt"}, "message": "add hello", "fingerprint": st.Fingerprint,
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

	if err := os.WriteFile(filepath.Join(repo, "hello.txt"), []byte("hello2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "extra.txt"), []byte("extra\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(repo, ".DS_Store"), []byte("meta"), 0o644); err != nil {
		t.Fatal(err)
	}

	hideBody, _ := json.Marshal(map[string]any{"hideRules": []string{"*.DS*"}})
	req, _ = http.NewRequest(http.MethodPut, base+"/local-api/v1/projects/"+id, bytes.NewReader(hideBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var hideRes struct {
		OK        bool     `json:"ok"`
		HideRules []string `json:"hideRules"`
	}
	_ = json.NewDecoder(res.Body).Decode(&hideRes)
	res.Body.Close()
	if res.StatusCode != 200 || !hideRes.OK || len(hideRes.HideRules) != 1 || hideRes.HideRules[0] != "*.DS*" {
		t.Fatalf("put hideRules: status=%d body=%+v", res.StatusCode, hideRes)
	}

	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/tree?source=worktree")
	if err != nil {
		t.Fatal(err)
	}
	var tree struct {
		Entries []struct {
			Name string `json:"name"`
		} `json:"entries"`
	}
	_ = json.NewDecoder(res.Body).Decode(&tree)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("tree %d", res.StatusCode)
	}
	foundExtra := false
	for _, e := range tree.Entries {
		if e.Name == ".git" {
			t.Fatal(".git listed")
		}
		if e.Name == ".DS_Store" {
			t.Fatal(".DS_Store should be hidden by hideRules")
		}
		if e.Name == "extra.txt" {
			foundExtra = true
		}
	}
	if !foundExtra {
		t.Fatal("worktree missing extra.txt")
	}

	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/content?source=worktree&path=hello.txt")
	if err != nil {
		t.Fatal(err)
	}
	var wtContent struct {
		Content string `json:"content"`
	}
	_ = json.NewDecoder(res.Body).Decode(&wtContent)
	res.Body.Close()
	if wtContent.Content != "hello2\n" {
		t.Fatalf("worktree content=%q", wtContent.Content)
	}

	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/content?source=head&path=hello.txt")
	if err != nil {
		t.Fatal(err)
	}
	var headContent struct {
		Content string `json:"content"`
	}
	_ = json.NewDecoder(res.Body).Decode(&headContent)
	res.Body.Close()
	if headContent.Content != "hello\n" {
		t.Fatalf("head content=%q", headContent.Content)
	}

	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/tree?source=nope")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatalf("bad source %d", res.StatusCode)
	}

	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/content?source=worktree&path=../x")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatalf("escape content %d", res.StatusCode)
	}
}

func TestContentPutAndAssetAPI(t *testing.T) {
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
	csrf := readCSRF(client, base)

	repo := t.TempDir()
	body, _ := json.Marshal(map[string]any{"path": repo, "init": true})
	req, _ := http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var proj map[string]any
	_ = json.NewDecoder(res.Body).Decode(&proj)
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("add %d", res.StatusCode)
	}
	id, _ := proj["id"].(string)

	if err := os.WriteFile(filepath.Join(repo, "note.md"), []byte("# old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/content?source=worktree&path=note.md")
	if err != nil {
		t.Fatal(err)
	}
	var fc struct {
		Content  string `json:"content"`
		Revision string `json:"revision"`
		Editable bool   `json:"editable"`
	}
	_ = json.NewDecoder(res.Body).Decode(&fc)
	res.Body.Close()
	if res.StatusCode != 200 || !fc.Editable || fc.Revision == "" {
		t.Fatalf("get content status=%d editable=%v rev=%q", res.StatusCode, fc.Editable, fc.Revision)
	}

	// Stale revision → 409
	badBody, _ := json.Marshal(map[string]any{"path": "note.md", "content": "x\n", "revision": "deadbeef"})
	req, _ = http.NewRequest(http.MethodPut, base+"/local-api/v1/projects/"+id+"/content", bytes.NewReader(badBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var conflict map[string]any
	_ = json.NewDecoder(res.Body).Decode(&conflict)
	res.Body.Close()
	if res.StatusCode != 409 || conflict["code"] != "content_conflict" {
		t.Fatalf("conflict status=%d body=%v", res.StatusCode, conflict)
	}

	putBody, _ := json.Marshal(map[string]any{"path": "note.md", "content": "# new\n", "revision": fc.Revision})
	req, _ = http.NewRequest(http.MethodPut, base+"/local-api/v1/projects/"+id+"/content", bytes.NewReader(putBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var putRes map[string]any
	_ = json.NewDecoder(res.Body).Decode(&putRes)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("put %d %v", res.StatusCode, putRes)
	}
	got, _ := os.ReadFile(filepath.Join(repo, "note.md"))
	if string(got) != "# new\n" {
		t.Fatalf("disk=%q", got)
	}

	// CSRF required for PUT
	req, _ = http.NewRequest(http.MethodPut, base+"/local-api/v1/projects/"+id+"/content", bytes.NewReader(putBody))
	req.Header.Set("Content-Type", "application/json")
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatalf("put without csrf %d", res.StatusCode)
	}

	png := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3}
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	_ = w.WriteField("path", "note.md")
	part, err := w.CreateFormFile("file", "pic.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(png); err != nil {
		t.Fatal(err)
	}
	_ = w.Close()
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/assets", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var assetRes struct {
		RelativePath string `json:"relativePath"`
		Path         string `json:"path"`
	}
	_ = json.NewDecoder(res.Body).Decode(&assetRes)
	res.Body.Close()
	if res.StatusCode != 201 || assetRes.RelativePath != "assets/pic.png" {
		t.Fatalf("asset upload %d %+v", res.StatusCode, assetRes)
	}

	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/asset?source=worktree&path=" + assetRes.Path)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/png" || !bytes.Equal(data, png) {
		t.Fatalf("asset get status=%d ct=%s len=%d", res.StatusCode, res.Header.Get("Content-Type"), len(data))
	}

	// HEAD worktree content is not editable via PUT (source ignored — write is always worktree path)
	req, _ = http.NewRequest(http.MethodHead, base+"/local-api/v1/projects/"+id+"/content?source=worktree&path=note.md", nil)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("head content %d", res.StatusCode)
	}
}

func TestBranchAPIFlow(t *testing.T) {
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

	identBody, _ := json.Marshal(map[string]any{
		"identity": map[string]string{"name": "Branch User", "email": "branch@example.com"},
	})
	req, _ := http.NewRequest(http.MethodPut, base+"/local-api/v1/settings", bytes.NewReader(identBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("settings %d", res.StatusCode)
	}

	repo := t.TempDir()
	body, _ := json.Marshal(map[string]any{"path": repo, "init": true})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var proj map[string]any
	_ = json.NewDecoder(res.Body).Decode(&proj)
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("add %d", res.StatusCode)
	}
	id, _ := proj["id"].(string)

	if err := os.WriteFile(filepath.Join(repo, "note.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	commitBody, _ := json.Marshal(map[string]any{
		"paths": []string{"note.txt"}, "message": "first", "fingerprint": "",
	})
	// fingerprint required - get status first
	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/status")
	if err != nil {
		t.Fatal(err)
	}
	var st map[string]any
	_ = json.NewDecoder(res.Body).Decode(&st)
	res.Body.Close()
	fp, _ := st["fingerprint"].(string)
	commitBody, _ = json.Marshal(map[string]any{
		"paths": []string{"note.txt"}, "message": "first", "fingerprint": fp,
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

	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/branches")
	if err != nil {
		t.Fatal(err)
	}
	var list struct {
		Current   string `json:"current"`
		CanSwitch bool   `json:"canSwitch"`
		Branches  []struct {
			Name string `json:"name"`
		} `json:"branches"`
	}
	_ = json.NewDecoder(res.Body).Decode(&list)
	res.Body.Close()
	if res.StatusCode != 200 || !list.CanSwitch || list.Current == "" {
		t.Fatalf("list branches status=%d %#v", res.StatusCode, list)
	}

	createBody, _ := json.Marshal(map[string]any{"name": "feature/api"})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/branches/create", bytes.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var created struct {
		OK     bool   `json:"ok"`
		Branch string `json:"branch"`
	}
	_ = json.NewDecoder(res.Body).Decode(&created)
	res.Body.Close()
	if res.StatusCode != 200 || !created.OK || created.Branch != "feature/api" {
		t.Fatalf("create %#v status=%d", created, res.StatusCode)
	}

	res, err = client.Get(base + "/local-api/v1/projects/" + id + "/status")
	if err != nil {
		t.Fatal(err)
	}
	var statusAfter struct {
		Health struct {
			Branch string `json:"branch"`
		} `json:"health"`
	}
	_ = json.NewDecoder(res.Body).Decode(&statusAfter)
	res.Body.Close()
	if statusAfter.Health.Branch != "feature/api" {
		t.Fatalf("status branch %q", statusAfter.Health.Branch)
	}

	switchBody, _ := json.Marshal(map[string]any{"name": list.Current})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/branches/switch", bytes.NewReader(switchBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("switch %d", res.StatusCode)
	}

	renameBody, _ := json.Marshal(map[string]any{"oldName": "feature/api", "newName": "feature/done"})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/branches/rename", bytes.NewReader(renameBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("rename %d", res.StatusCode)
	}

	delBody, _ := json.Marshal(map[string]any{"name": "feature/done"})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/branches/delete", bytes.NewReader(delBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("delete %d", res.StatusCode)
	}

	// Unauthenticated list
	res, err = http.Get(base + "/local-api/v1/projects/" + id + "/branches")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatalf("unauth branches %d", res.StatusCode)
	}

	// Dirty worktree blocks switch
	if err := os.WriteFile(filepath.Join(repo, "note.txt"), []byte("dirty\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	createBody, _ = json.Marshal(map[string]any{"name": "blocked"})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/projects/"+id+"/branches/create", bytes.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatalf("dirty create should 400, got %d", res.StatusCode)
	}
}
