package localapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/forkly-app/forkly/internal/app"
	"github.com/forkly-app/forkly/internal/diagnostics"
	"github.com/forkly-app/forkly/internal/session"
)

func TestAgentPairHTTPBoundaries(t *testing.T) {
	log, err := diagnostics.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	dataDir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h, err := app.StartServerOnly(ctx, log, app.ServerOnlyOptions{DataDir: dataDir})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Shutdown(context.Background())
	base := h.Addr

	startBody, _ := json.Marshal(map[string]any{"clientName": "TestCLI", "preset": "collaborate"})
	res, err := http.Post(base+"/local-api/v1/agent/pair/start", "application/json", bytes.NewReader(startBody))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("start %d %s", res.StatusCode, b)
	}
	var start map[string]any
	_ = json.NewDecoder(res.Body).Decode(&start)
	pairID, _ := start["pairId"].(string)
	userCode, _ := start["userCode"].(string)
	deviceSecret, _ := start["deviceSecret"].(string)
	if pairID == "" || userCode == "" || deviceSecret == "" {
		t.Fatalf("incomplete start: %#v", start)
	}

	res, err = http.Get(base + "/local-api/v1/agent/pair/status?pairId=" + pairID)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("status %d %s", res.StatusCode, raw)
	}
	var status map[string]any
	_ = json.Unmarshal(raw, &status)
	if _, ok := status["userCode"]; ok {
		t.Fatal("status should not include userCode")
	}
	if _, ok := status["deviceSecret"]; ok {
		t.Fatal("status should not include deviceSecret")
	}

	browser, err := app.ClaimClient(h.OpenURL)
	if err != nil {
		t.Fatal(err)
	}
	csrf := readCSRF(browser, base)
	approveBody, _ := json.Marshal(map[string]any{"pairId": pairID})
	req, _ := http.NewRequest(http.MethodPost, base+"/local-api/v1/agent/pair/approve", bytes.NewReader(approveBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = browser.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("approve %d %s", res.StatusCode, b)
	}

	// wrong device secret
	bad, _ := json.Marshal(map[string]any{
		"pairId": pairID, "userCode": userCode, "deviceSecret": "deadbeef",
	})
	res, err = http.Post(base+"/local-api/v1/agent/pair/claim", "application/json", bytes.NewReader(bad))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode == 200 {
		t.Fatal("wrong deviceSecret must fail")
	}

	good, _ := json.Marshal(map[string]any{
		"pairId": pairID, "userCode": userCode, "deviceSecret": deviceSecret,
	})
	res, err = http.Post(base+"/local-api/v1/agent/pair/claim", "application/json", bytes.NewReader(good))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("claim %d", res.StatusCode)
	}
	var claim map[string]any
	_ = json.NewDecoder(res.Body).Decode(&claim)
	token, _ := claim["token"].(string)
	if token == "" || claim["status"] != "approved" {
		t.Fatalf("%#v", claim)
	}

	for _, path := range []string{
		"/local-api/v1/agent/pair/pending",
		"/local-api/v1/agent/clients",
	} {
		req, _ = http.NewRequest(http.MethodGet, base+path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		res, err = http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("%s with bearer got %d want 403", path, res.StatusCode)
		}
	}

	req, _ = http.NewRequest(http.MethodGet, base+"/local-api/v1/projects", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("projects with bearer %d", res.StatusCode)
	}
}

func TestAgentCLIListStatusCommit(t *testing.T) {
	log, err := diagnostics.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	dataDir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h, err := app.StartServerOnly(ctx, log, app.ServerOnlyOptions{DataDir: dataDir})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Shutdown(context.Background())
	base := h.Addr

	browser, err := app.ClaimClient(h.OpenURL)
	if err != nil {
		t.Fatal(err)
	}
	csrf := readCSRF(browser, base)

	// identity for commits
	identBody, _ := json.Marshal(map[string]any{
		"identity": map[string]string{"name": "CLI Test", "email": "cli@example.com"},
	})
	req, _ := http.NewRequest(http.MethodPut, base+"/local-api/v1/settings", bytes.NewReader(identBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err := browser.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	startBody, _ := json.Marshal(map[string]any{"clientName": "Journey", "preset": "full_control"})
	res, err = http.Post(base+"/local-api/v1/agent/pair/start", "application/json", bytes.NewReader(startBody))
	if err != nil {
		t.Fatal(err)
	}
	var start map[string]any
	_ = json.NewDecoder(res.Body).Decode(&start)
	res.Body.Close()
	pairID, _ := start["pairId"].(string)
	userCode, _ := start["userCode"].(string)
	deviceSecret, _ := start["deviceSecret"].(string)

	approveBody, _ := json.Marshal(map[string]any{"pairId": pairID})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/agent/pair/approve", bytes.NewReader(approveBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = browser.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	claimBody, _ := json.Marshal(map[string]any{
		"pairId": pairID, "userCode": userCode, "deviceSecret": deviceSecret,
	})
	res, err = http.Post(base+"/local-api/v1/agent/pair/claim", "application/json", bytes.NewReader(claimBody))
	if err != nil {
		t.Fatal(err)
	}
	var claim map[string]any
	_ = json.NewDecoder(res.Body).Decode(&claim)
	res.Body.Close()
	token, _ := claim["token"].(string)
	if token == "" {
		t.Fatal("no token")
	}

	agentDo := func(method, path string, body any) (*http.Response, error) {
		var rdr io.Reader
		if body != nil {
			raw, _ := json.Marshal(body)
			rdr = bytes.NewReader(raw)
		}
		req, _ := http.NewRequest(method, base+path, rdr)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		req.Header.Set("Authorization", "Bearer "+token)
		return http.DefaultClient.Do(req)
	}

	repo := t.TempDir()
	res, err = agentDo(http.MethodPost, "/local-api/v1/projects", map[string]any{"path": repo, "init": true})
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 201 {
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		t.Fatalf("add project %d %s", res.StatusCode, b)
	}
	var proj map[string]any
	_ = json.NewDecoder(res.Body).Decode(&proj)
	res.Body.Close()
	id, _ := proj["id"].(string)

	res, err = agentDo(http.MethodGet, "/local-api/v1/projects", nil)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("list %d", res.StatusCode)
	}

	_ = os.WriteFile(filepath.Join(repo, "note.md"), []byte("# hi\n"), 0o644)

	var st struct {
		Files       []map[string]any `json:"files"`
		Fingerprint string           `json:"fingerprint"`
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		res, err = agentDo(http.MethodGet, "/local-api/v1/projects/"+id+"/status", nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.NewDecoder(res.Body).Decode(&st); err != nil {
			res.Body.Close()
			t.Fatal(err)
		}
		res.Body.Close()
		if len(st.Files) > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("expected changes")
		}
		time.Sleep(20 * time.Millisecond)
	}

	res, err = agentDo(http.MethodPost, "/local-api/v1/projects/"+id+"/commit", map[string]any{
		"paths": []string{"note.md"}, "message": "add note", "fingerprint": st.Fingerprint,
	})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("commit %d %s", res.StatusCode, b)
	}

	// journey: create file via entries, rename, hide-rules, branch, history
	res, err = agentDo(http.MethodPost, "/local-api/v1/projects/"+id+"/entries", map[string]any{
		"kind": "file", "parentPath": "", "name": "todo.md",
	})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 201 && res.StatusCode != 200 {
		t.Fatalf("create entry %d", res.StatusCode)
	}

	res, err = agentDo(http.MethodPut, "/local-api/v1/projects/"+id+"/content", map[string]any{
		"path": "todo.md", "content": "- item\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	res, err = agentDo(http.MethodPatch, "/local-api/v1/projects/"+id+"/entries", map[string]any{
		"path": "todo.md", "name": "tasks.md",
	})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	res, err = agentDo(http.MethodGet, "/local-api/v1/projects/"+id+"/status", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = json.NewDecoder(res.Body).Decode(&st)
	res.Body.Close()
	res, err = agentDo(http.MethodPost, "/local-api/v1/projects/"+id+"/commit", map[string]any{
		"paths": []string{"tasks.md"}, "message": "tasks", "fingerprint": st.Fingerprint,
	})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	res, err = agentDo(http.MethodPost, "/local-api/v1/projects/"+id+"/branches/create", map[string]any{"name": "feature/cli"})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	res, err = agentDo(http.MethodGet, "/local-api/v1/projects/"+id+"/history", nil)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("history %d", res.StatusCode)
	}

	res, err = agentDo(http.MethodDelete, "/local-api/v1/projects/"+id, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	b, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 && res.StatusCode != 204 {
		t.Fatalf("remove registration %d %s", res.StatusCode, b)
	}
}
