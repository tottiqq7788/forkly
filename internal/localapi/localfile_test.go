package localapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/forkly-app/forkly/internal/app"
	"github.com/forkly-app/forkly/internal/diagnostics"
	"github.com/forkly-app/forkly/internal/session"
)

func TestLocalFileAPI(t *testing.T) {
	log, err := diagnostics.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h, err := app.StartServerOnly(ctx, log, app.ServerOnlyOptions{DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Shutdown(context.Background())

	client, err := app.ClaimClient(h.OpenURL)
	if err != nil {
		t.Fatal(err)
	}
	base := baseFrom(h.OpenURL)
	csrf := readCSRF(client, base)

	dir := t.TempDir()
	path := filepath.Join(dir, "note.md")
	if err := os.WriteFile(path, []byte("# hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	sib := filepath.Join(dir, "sib.md")
	if err := os.WriteFile(sib, []byte("# sib\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	meta, err := h.LocalFiles.Open(path)
	if err != nil {
		t.Fatal(err)
	}

	res, err := client.Get(base + "/local-api/v1/local-files/" + meta.FileID)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("meta %d", res.StatusCode)
	}
	var got map[string]any
	_ = json.NewDecoder(res.Body).Decode(&got)
	if got["fileId"] != meta.FileID || got["absPath"] == "" {
		t.Fatalf("unexpected meta body %#v", got)
	}

	res, err = client.Get(base + "/local-api/v1/local-files/" + meta.FileID + "/content")
	if err != nil {
		t.Fatal(err)
	}
	var content struct {
		Content  string `json:"content"`
		Revision string `json:"revision"`
		Editable bool   `json:"editable"`
	}
	_ = json.NewDecoder(res.Body).Decode(&content)
	res.Body.Close()
	if res.StatusCode != 200 || !content.Editable || content.Revision == "" {
		t.Fatalf("content %d %#v", res.StatusCode, content)
	}
	etag := res.Header.Get("ETag")
	if etag == "" {
		etag = `"` + content.Revision + `"`
	}

	req, _ := http.NewRequest(http.MethodGet, base+"/local-api/v1/local-files/"+meta.FileID+"/content", nil)
	req.Header.Set("If-None-Match", etag)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", res.StatusCode)
	}

	putBody, _ := json.Marshal(map[string]any{"content": "# saved\n", "revision": content.Revision})
	req, _ = http.NewRequest(http.MethodPut, base+"/local-api/v1/local-files/"+meta.FileID+"/content", bytes.NewReader(putBody))
	req.Header.Set("Content-Type", "application/json")
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden && res.StatusCode != http.StatusUnauthorized {
		// CSRF required
		if res.StatusCode == 200 {
			t.Fatal("expected CSRF rejection without header")
		}
	}

	req, _ = http.NewRequest(http.MethodPut, base+"/local-api/v1/local-files/"+meta.FileID+"/content", bytes.NewReader(putBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var writeRes struct {
		Revision string `json:"revision"`
	}
	_ = json.NewDecoder(res.Body).Decode(&writeRes)
	res.Body.Close()
	if res.StatusCode != 200 || writeRes.Revision == "" {
		t.Fatalf("put %d %#v", res.StatusCode, writeRes)
	}

	req, _ = http.NewRequest(http.MethodPut, base+"/local-api/v1/local-files/"+meta.FileID+"/content", bytes.NewReader(putBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409, got %d", res.StatusCode)
	}

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", "shot.png")
	if err != nil {
		t.Fatal(err)
	}
	png := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
		0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
		0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
		0x00, 0x05, 0xfe, 0x02, 0xfe, 0xa1, 0x05, 0x9e,
		0x3c, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
		0x44, 0xae, 0x42, 0x60, 0x82,
	}
	if _, err := part.Write(png); err != nil {
		t.Fatal(err)
	}
	_ = w.Close()
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/local-files/"+meta.FileID+"/assets", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var asset struct {
		Path string `json:"path"`
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	_ = json.Unmarshal(body, &asset)
	if res.StatusCode != http.StatusCreated || asset.Path == "" {
		t.Fatalf("upload %d %s", res.StatusCode, body)
	}

	res, err = client.Get(base + "/local-api/v1/local-files/" + meta.FileID + "/asset?path=" + asset.Path)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("asset get %d", res.StatusCode)
	}

	openBody, _ := json.Marshal(map[string]any{"path": "sib.md"})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/local-files/"+meta.FileID+"/open-relative", bytes.NewReader(openBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var relMeta struct {
		FileID string `json:"fileId"`
		Name   string `json:"name"`
	}
	_ = json.NewDecoder(res.Body).Decode(&relMeta)
	res.Body.Close()
	if res.StatusCode != 200 || relMeta.FileID == "" || relMeta.Name != "sib.md" {
		t.Fatalf("open-relative %d %#v", res.StatusCode, relMeta)
	}

	badBody, _ := json.Marshal(map[string]any{"path": "../outside.md"})
	req, _ = http.NewRequest(http.MethodPost, base+"/local-api/v1/local-files/"+meta.FileID+"/open-relative", bytes.NewReader(badBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(session.CSRFHeader, csrf)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode == 200 {
		t.Fatal("expected open-relative escape rejection")
	}

	res, err = client.Get(base + "/local-api/v1/local-files/unknown-id/content")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode == 200 {
		t.Fatal("expected unknown id rejection")
	}
}

func TestOpenConsoleURLWithNext(t *testing.T) {
	log, err := diagnostics.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h, err := app.StartServerOnly(ctx, log, app.ServerOnlyOptions{DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Shutdown(context.Background())

	u := h.OpenConsoleURLWithNext("/editor/local/abc123")
	if !strings.Contains(u, "next=%2Feditor%2Flocal%2Fabc123") {
		t.Fatalf("expected escaped next path, got %s", u)
	}
	if u := h.OpenConsoleURLWithNext("//evil"); !strings.Contains(u, "next=%2F") || strings.Contains(u, "evil") {
		t.Fatalf("expected unsafe next rejected, got %s", u)
	}
}
