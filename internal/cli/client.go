package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/credentials"
	"github.com/forkly-app/forkly/internal/runtimeinfo"
)

const (
	ExitOK            = 0
	ExitUserError     = 1
	ExitUnavailable   = 2
	ExitIncompatible  = 3
	ExitAuthRequired  = 4
	ExitDenied        = 5
)

type Envelope struct {
	OK      bool            `json:"ok"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   *EnvelopeError  `json:"error,omitempty"`
}

type EnvelopeError struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

type Client struct {
	HTTP       *http.Client
	DataDir    string
	BaseURL    string
	Token      string
	AppVersion string
	JSON       bool
	Out        io.Writer
	Err        io.Writer
}

const cliAuthAccount = "forklyctl"

type storedAuth struct {
	ClientID string   `json:"clientId"`
	Token    string   `json:"token"`
	Scopes   []string `json:"scopes,omitempty"`
}

type storedAuthMeta struct {
	ClientID string   `json:"clientId"`
	Scopes   []string `json:"scopes,omitempty"`
}

func NewClient(jsonOut bool) (*Client, error) {
	dataDir, err := config.DefaultDataDir()
	if err != nil {
		return nil, err
	}
	c := &Client{
		HTTP:    &http.Client{Timeout: 60 * time.Second},
		DataDir: dataDir,
		JSON:    jsonOut,
		Out:     os.Stdout,
		Err:     os.Stderr,
	}
	_ = c.loadAuth()
	return c, nil
}

func (c *Client) authPath() string {
	return filepath.Join(c.DataDir, "agent", "cli-auth.json")
}

func (c *Client) agentCreds() credentials.Store {
	return credentials.NewKeychainStoreForService(credentials.AgentServiceName)
}

func (c *Client) loadAuth() error {
	raw, err := os.ReadFile(c.authPath())
	if err != nil {
		return err
	}
	var meta storedAuthMeta
	var legacy storedAuth
	if err := json.Unmarshal(raw, &legacy); err == nil && legacy.Token != "" {
		c.Token = legacy.Token
		_ = c.SaveAuth(legacy.ClientID, legacy.Token, legacy.Scopes)
		return nil
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		return err
	}
	secret, err := c.agentCreds().Get(cliAuthAccount)
	if err != nil {
		return err
	}
	c.Token = secret.Token
	return nil
}

func (c *Client) SaveAuth(clientID, token string, scopes []string) error {
	dir := filepath.Dir(c.authPath())
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if err := c.agentCreds().Set(cliAuthAccount, credentials.Secret{
		Kind:   credentials.KindPAT,
		Token:  token,
		Scopes: strings.Join(scopes, " "),
		Login:  clientID,
	}); err != nil {
		// Fallback: encrypted OS store unavailable — keep token file at 0600.
		raw, err2 := json.MarshalIndent(storedAuth{ClientID: clientID, Token: token, Scopes: scopes}, "", "  ")
		if err2 != nil {
			return err
		}
		tmp := c.authPath() + ".tmp"
		if err2 := os.WriteFile(tmp, raw, 0o600); err2 != nil {
			return err
		}
		if err2 := os.Rename(tmp, c.authPath()); err2 != nil {
			return err
		}
		c.Token = token
		return nil
	}
	raw, err := json.MarshalIndent(storedAuthMeta{ClientID: clientID, Scopes: scopes}, "", "  ")
	if err != nil {
		return err
	}
	tmp := c.authPath() + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, c.authPath()); err != nil {
		return err
	}
	c.Token = token
	return nil
}

func (c *Client) ClearAuth() error {
	c.Token = ""
	_ = c.agentCreds().Delete(cliAuthAccount)
	_ = os.Remove(c.authPath())
	_ = os.Remove(c.trustPath())
	return nil
}

func (c *Client) Discover() (runtimeinfo.Info, error) {
	info, err := runtimeinfo.Read(c.DataDir)
	if err != nil {
		return runtimeinfo.Info{}, err
	}
	if info.Nonce == "" || info.PID <= 0 {
		return runtimeinfo.Info{}, fmt.Errorf("runtime 描述无效或不完整")
	}
	if !runtimeinfo.ProcessAlive(info.PID) {
		return runtimeinfo.Info{}, fmt.Errorf("runtime 指向的进程不存在（陈旧发现文件）")
	}
	c.BaseURL = info.BaseURL
	return info, nil
}

func (c *Client) Health() (map[string]any, error) {
	if c.BaseURL == "" {
		if _, err := c.Discover(); err != nil {
			return nil, err
		}
	}
	var out map[string]any
	if err := c.doJSON(http.MethodGet, "/local-api/v1/health", nil, &out, false); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) attestHealth(info runtimeinfo.Info, health map[string]any) error {
	pid := intFromAny(health["pid"])
	nonce, _ := health["nonce"].(string)
	if pid != info.PID || nonce == "" || nonce != info.Nonce {
		return fmt.Errorf("Local API 身份与 runtime/api.json 不一致（可能被篡改或已过期）")
	}
	if trust, err := c.loadTrustedRuntime(); err == nil {
		if c.Token != "" && (trust.BaseURL != info.BaseURL || trust.Nonce != info.Nonce) {
			return fmt.Errorf("运行时实例已变更，请重新运行 forklyctl pair")
		}
	}
	return nil
}

func intFromAny(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	default:
		return 0
	}
}

type trustedRuntime struct {
	BaseURL string `json:"baseUrl"`
	Nonce   string `json:"nonce"`
}

func (c *Client) trustPath() string {
	return filepath.Join(c.DataDir, "agent", "trusted-runtime.json")
}

func (c *Client) loadTrustedRuntime() (trustedRuntime, error) {
	raw, err := os.ReadFile(c.trustPath())
	if err != nil {
		return trustedRuntime{}, err
	}
	var t trustedRuntime
	if err := json.Unmarshal(raw, &t); err != nil {
		return trustedRuntime{}, err
	}
	return t, nil
}

func (c *Client) SaveTrustedRuntime(info runtimeinfo.Info) error {
	dir := filepath.Dir(c.trustPath())
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(trustedRuntime{BaseURL: info.BaseURL, Nonce: info.Nonce}, "", "  ")
	if err != nil {
		return err
	}
	tmp := c.trustPath() + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, c.trustPath())
}

func (c *Client) Ensure(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		if info, err := c.Discover(); err == nil {
			c.BaseURL = info.BaseURL
			if h, err := c.Health(); err == nil {
				if err := c.attestHealth(info, h); err != nil {
					return err
				}
				if info.APIVersion > runtimeinfo.APIVersion {
					return fmt.Errorf("API 版本过新（%d > %d），请升级 forklyctl", info.APIVersion, runtimeinfo.APIVersion)
				}
				return nil
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("无法连接 Forkly Local API，请先启动 Forkly")
		}
		_ = LaunchDesktop()
		time.Sleep(500 * time.Millisecond)
	}
}

func (c *Client) doJSON(method, path string, body any, out any, auth bool) error {
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, strings.TrimRight(c.BaseURL, "/")+path, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if auth {
		if c.Token == "" {
			return fmt.Errorf("尚未配对：请运行 forklyctl pair")
		}
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode >= 400 {
		var e struct {
			Error   string `json:"error"`
			Code    string `json:"code"`
			Details any    `json:"details"`
		}
		_ = json.Unmarshal(raw, &e)
		msg := e.Error
		if msg == "" {
			msg = string(raw)
		}
		return &APIError{Status: res.StatusCode, Code: e.Code, Message: msg, Details: e.Details}
	}
	if out == nil || len(raw) == 0 || string(raw) == "null\n" {
		return nil
	}
	return json.Unmarshal(raw, out)
}

type APIError struct {
	Status  int
	Code    string
	Message string
	Details any
}

func (e *APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("%s (%s)", e.Message, e.Code)
	}
	return e.Message
}

func (c *Client) doMultipart(method, path, field, filePath string, formFields map[string]string, out any) error {
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range formFields {
		if err := w.WriteField(k, v); err != nil {
			return err
		}
	}
	part, err := w.CreateFormFile(field, filepath.Base(filePath))
	if err != nil {
		return err
	}
	if _, err := io.Copy(part, f); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	req, err := http.NewRequest(method, strings.TrimRight(c.BaseURL, "/")+path, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	if c.Token == "" {
		return fmt.Errorf("尚未配对：请运行 forklyctl pair")
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode >= 400 {
		var e struct {
			Error   string `json:"error"`
			Code    string `json:"code"`
			Details any    `json:"details"`
		}
		_ = json.Unmarshal(raw, &e)
		msg := e.Error
		if msg == "" {
			msg = string(raw)
		}
		return &APIError{Status: res.StatusCode, Code: e.Code, Message: msg, Details: e.Details}
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}

func (c *Client) PrintResult(data any) int {
	if c.JSON {
		env := Envelope{OK: true}
		raw, _ := json.Marshal(data)
		env.Data = raw
		enc := json.NewEncoder(c.Out)
		enc.SetIndent("", "  ")
		_ = enc.Encode(env)
		return ExitOK
	}
	enc := json.NewEncoder(c.Out)
	enc.SetIndent("", "  ")
	_ = enc.Encode(data)
	return ExitOK
}

func (c *Client) PrintErr(err error) int {
	code := ExitUserError
	msg := err.Error()
	apiCode := ""
	var details any
	if ae, ok := err.(*APIError); ok {
		msg = ae.Message
		apiCode = ae.Code
		details = ae.Details
		switch {
		case ae.Status == http.StatusUnauthorized:
			code = ExitAuthRequired
		case ae.Status == http.StatusForbidden:
			code = ExitDenied
		case ae.Status >= 500:
			code = ExitUnavailable
		}
	} else if strings.Contains(msg, "尚未配对") {
		code = ExitAuthRequired
	} else if strings.Contains(msg, "无法连接") || strings.Contains(msg, "升级") {
		code = ExitUnavailable
		if strings.Contains(msg, "升级") {
			code = ExitIncompatible
		}
	}
	if c.JSON {
		env := Envelope{OK: false, Error: &EnvelopeError{Code: apiCode, Message: msg, Details: details}}
		enc := json.NewEncoder(c.Out)
		enc.SetIndent("", "  ")
		_ = enc.Encode(env)
		return code
	}
	fmt.Fprintln(c.Err, "错误:", msg)
	return code
}

func QueryEscape(s string) string { return url.QueryEscape(s) }
