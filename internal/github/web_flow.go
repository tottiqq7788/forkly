package github

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/forkly-app/forkly/internal/credentials"
	"github.com/forkly-app/forkly/internal/session"
)

// ClientSecret is injected at build time for Web OAuth token exchange. Not a security boundary.
var ClientSecret = ""

const webOAuthTTL = 10 * time.Minute

type webOAuthFlow struct {
	CodeVerifier string
	RedirectURI  string
	ReturnTo     string
	ProjectID    string
	CreatedAt    time.Time
	ExpiresAt    time.Time
	Consumed     bool
}

// WebOAuthStartResult is returned to the browser session that initiated authorization.
type WebOAuthStartResult struct {
	AuthorizationURL string `json:"authorizationUrl"`
	State            string `json:"state"`
}

// WebOAuthCompleteResult is produced after a successful callback exchange.
type WebOAuthCompleteResult struct {
	User      User
	AccountID string
	ProjectID string
	ReturnTo  string
}

func (c *Client) DeviceFlowConfigured() bool {
	return strings.TrimSpace(c.ClientID) != ""
}

func (c *Client) WebOAuthConfigured() bool {
	return strings.TrimSpace(c.ClientID) != "" && strings.TrimSpace(c.clientSecret()) != ""
}

func (c *Client) clientSecret() string {
	if strings.TrimSpace(c.ClientSecret) != "" {
		return strings.TrimSpace(c.ClientSecret)
	}
	return strings.TrimSpace(ClientSecret)
}

// StartWebOAuth begins Authorization Code + PKCE. redirectURI must match the callback request.
func (c *Client) StartWebOAuth(_ context.Context, redirectURI, projectID, returnTo string) (WebOAuthStartResult, error) {
	if !c.WebOAuthConfigured() {
		return WebOAuthStartResult{}, &APIError{Code: CodeConfigMissing, Message: "未配置 GitHub Web OAuth，请改用设备码或个人访问令牌"}
	}
	redirectURI = strings.TrimSpace(redirectURI)
	if redirectURI == "" {
		return WebOAuthStartResult{}, fmt.Errorf("回调地址无效")
	}
	verifier, err := generateCodeVerifier()
	if err != nil {
		return WebOAuthStartResult{}, err
	}
	state := session.RandomURLSafe(32)
	challenge := codeChallengeS256(verifier)
	now := time.Now()
	flow := &webOAuthFlow{
		CodeVerifier: verifier,
		RedirectURI:  redirectURI,
		ReturnTo:     strings.TrimSpace(returnTo),
		ProjectID:    strings.TrimSpace(projectID),
		CreatedAt:    now,
		ExpiresAt:    now.Add(webOAuthTTL),
	}
	c.mu.Lock()
	if c.webFlows == nil {
		c.webFlows = map[string]*webOAuthFlow{}
	}
	c.webFlows[state] = flow
	c.mu.Unlock()

	params := url.Values{}
	params.Set("client_id", c.ClientID)
	params.Set("redirect_uri", redirectURI)
	params.Set("scope", "repo")
	params.Set("state", state)
	params.Set("code_challenge", challenge)
	params.Set("code_challenge_method", "S256")
	params.Set("response_type", "code")

	return WebOAuthStartResult{
		AuthorizationURL: c.LoginBase + "/login/oauth/authorize?" + params.Encode(),
		State:            state,
	}, nil
}

// CompleteWebOAuth validates state, exchanges the code, stores credentials, and returns intent metadata.
func (c *Client) CompleteWebOAuth(ctx context.Context, code, state, redirectURI string) (WebOAuthCompleteResult, error) {
	code = strings.TrimSpace(code)
	state = strings.TrimSpace(state)
	redirectURI = strings.TrimSpace(redirectURI)
	if code == "" || state == "" {
		return WebOAuthCompleteResult{}, &APIError{Code: CodeAuthRequired, Message: "授权未完成或已取消"}
	}
	flow, err := c.validateWebFlow(state, redirectURI)
	if err != nil {
		return WebOAuthCompleteResult{}, err
	}
	defer c.finishWebFlow(state)

	token, err := c.exchangeAuthCode(ctx, code, flow.CodeVerifier, redirectURI)
	if err != nil {
		return WebOAuthCompleteResult{ReturnTo: flow.ReturnTo, ProjectID: flow.ProjectID}, err
	}
	user, err := c.GetUser(ctx, token.AccessToken)
	if err != nil {
		return WebOAuthCompleteResult{ReturnTo: flow.ReturnTo, ProjectID: flow.ProjectID}, err
	}
	accountID := fmt.Sprintf("gh_%d", user.ID)
	secret := credentials.Secret{
		Kind:         credentials.KindOAuth,
		Token:        token.AccessToken,
		RefreshToken: token.RefreshToken,
		Scopes:       token.Scope,
		Login:        user.Login,
	}
	if token.ExpiresIn > 0 {
		secret.ExpiresAt = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second)
	}
	if err := c.Creds.Set(accountID, secret); err != nil {
		return WebOAuthCompleteResult{ReturnTo: flow.ReturnTo, ProjectID: flow.ProjectID}, &APIError{Code: CodeAuthRequired, Message: "无法写入系统安全存储：" + err.Error()}
	}
	return WebOAuthCompleteResult{
		User:      user,
		AccountID: accountID,
		ProjectID: flow.ProjectID,
		ReturnTo:  flow.ReturnTo,
	}, nil
}

func (c *Client) validateWebFlow(state, redirectURI string) (*webOAuthFlow, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.webFlows == nil {
		return nil, &APIError{Code: CodeAuthRequired, Message: "授权状态无效或已过期"}
	}
	flow, ok := c.webFlows[state]
	if !ok {
		return nil, &APIError{Code: CodeAuthRequired, Message: "授权状态无效或已过期"}
	}
	if flow.Consumed {
		return nil, &APIError{Code: CodeAuthRequired, Message: "授权状态已被使用"}
	}
	if time.Now().After(flow.ExpiresAt) {
		return nil, &APIError{Code: CodeAuthRequired, Message: "授权已过期，请重新开始"}
	}
	if flow.RedirectURI != redirectURI {
		return nil, &APIError{Code: CodeAuthRequired, Message: "回调地址不匹配"}
	}
	return flow, nil
}

func (c *Client) finishWebFlow(state string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.webFlows == nil {
		return
	}
	if flow, ok := c.webFlows[state]; ok {
		flow.Consumed = true
		delete(c.webFlows, state)
	}
}

// DropWebOAuthFlow removes a pending flow (e.g. user denied) and returns the saved return URL.
func (c *Client) DropWebOAuthFlow(state string) string {
	state = strings.TrimSpace(state)
	if state == "" {
		return ""
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	flow, ok := c.webFlows[state]
	if !ok {
		return ""
	}
	delete(c.webFlows, state)
	return flow.ReturnTo
}

func (c *Client) exchangeAuthCode(ctx context.Context, code, verifier, redirectURI string) (tokenResponse, error) {
	form := url.Values{}
	form.Set("client_id", c.ClientID)
	form.Set("client_secret", c.clientSecret())
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("code_verifier", verifier)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.LoginBase+"/login/oauth/access_token", strings.NewReader(form.Encode()))
	if err != nil {
		return tokenResponse{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", userAgent)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return tokenResponse{}, mapTransport(err)
	}
	defer res.Body.Close()
	body, _ := readLimited(res.Body, 1<<20)
	var parsed tokenResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return tokenResponse{}, fmt.Errorf("解析令牌响应失败")
	}
	if parsed.Error != "" || parsed.AccessToken == "" {
		return tokenResponse{}, &APIError{Code: CodeAuthRequired, Message: firstNonEmpty(parsed.ErrorDesc, parsed.Error, "未获得访问令牌")}
	}
	return parsed, nil
}

func generateCodeVerifier() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func codeChallengeS256(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
