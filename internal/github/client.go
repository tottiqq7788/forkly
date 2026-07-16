package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/forkly-app/forkly/internal/credentials"
	"github.com/forkly-app/forkly/internal/session"
)

// ClientID is injected at build time via -ldflags. Empty means Device Flow is unavailable.
var ClientID = ""

const (
	defaultAPIBase   = "https://api.github.com"
	defaultLoginBase = "https://github.com"
	userAgent        = "Forkly-Desktop"
	apiVersion       = "2022-11-28"
)

// ErrorCode is a stable structured error for API mapping.
type ErrorCode string

const (
	CodeAuthRequired       ErrorCode = "auth_required"
	CodeTokenExpired       ErrorCode = "token_expired"
	CodePermissionDenied   ErrorCode = "permission_denied"
	CodeRepositoryNotFound ErrorCode = "repository_not_found"
	CodeOffline            ErrorCode = "offline"
	CodeTimeout            ErrorCode = "timeout"
	CodeRateLimited        ErrorCode = "rate_limited"
	CodeSSO                ErrorCode = "sso_required"
	CodeInvalidToken       ErrorCode = "invalid_token"
	CodeDevicePending      ErrorCode = "device_pending"
	CodeDeviceSlowDown     ErrorCode = "device_slow_down"
	CodeDeviceExpired      ErrorCode = "device_expired"
	CodeDeviceDenied       ErrorCode = "device_denied"
	CodeConfigMissing      ErrorCode = "oauth_not_configured"
)

// APIError is returned to callers with a user-facing Chinese message.
type APIError struct {
	Code    ErrorCode
	Message string
	Status  int
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return string(e.Code)
}

type Client struct {
	HTTP      *http.Client
	APIBase   string
	LoginBase string
	ClientID  string
	Creds     credentials.Store

	mu       sync.Mutex
	flows    map[string]*deviceFlow
	webFlows map[string]*webOAuthFlow
	ClientSecret string
}

type deviceFlow struct {
	DeviceCode      string
	UserCode        string
	VerificationURI string
	Interval        time.Duration
	ExpiresAt       time.Time
	StartedAt       time.Time
	Status          string // pending | complete | expired | denied | error
	ErrorMessage    string
	AccountID       string
	Login           string
	Cancel          context.CancelFunc
}

type User struct {
	Login     string `json:"login"`
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
}

type DeviceStartResult struct {
	FlowID          string `json:"flowId"`
	UserCode        string `json:"userCode"`
	VerificationURI string `json:"verificationUri"`
	ExpiresIn       int    `json:"expiresIn"`
	Interval        int    `json:"interval"`
}

type DeviceStatusResult struct {
	Status        string `json:"status"`
	ErrorMessage  string `json:"errorMessage,omitempty"`
	AccountID     string `json:"accountId,omitempty"`
	Login         string `json:"login,omitempty"`
	ExpiresIn     int    `json:"expiresIn,omitempty"`
}

type RepoInfo struct {
	FullName      string `json:"full_name"`
	Name          string `json:"name"`
	OwnerLogin    string `json:"owner_login"`
	Private       bool   `json:"private"`
	DefaultBranch string `json:"default_branch"`
	CloneURL      string `json:"clone_url"`
	HTMLURL       string `json:"html_url"`
	Description   string `json:"description"`
}

func NewClient(creds credentials.Store) *Client {
	return &Client{
		HTTP:      &http.Client{Timeout: 30 * time.Second},
		APIBase:   defaultAPIBase,
		LoginBase: defaultLoginBase,
		ClientID:     ClientID,
		ClientSecret: ClientSecret,
		Creds:        creds,
		flows:        map[string]*deviceFlow{},
		webFlows:     map[string]*webOAuthFlow{},
	}
}

func (c *Client) OAuthConfigured() bool {
	return c.DeviceFlowConfigured() || c.WebOAuthConfigured()
}

// StartDeviceFlow begins GitHub device authorization. Frontend never sees device_code.
func (c *Client) StartDeviceFlow(ctx context.Context) (DeviceStartResult, error) {
	if !c.DeviceFlowConfigured() {
		return DeviceStartResult{}, &APIError{Code: CodeConfigMissing, Message: "未配置 GitHub App Client ID，请改用个人访问令牌"}
	}
	form := url.Values{}
	form.Set("client_id", c.ClientID)
	form.Set("scope", "") // permissions come from the GitHub App registration
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.LoginBase+"/login/device/code", strings.NewReader(form.Encode()))
	if err != nil {
		return DeviceStartResult{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", userAgent)

	res, err := c.HTTP.Do(req)
	if err != nil {
		return DeviceStartResult{}, mapTransport(err)
	}
	defer res.Body.Close()
	body, _ := readLimited(res.Body, 1<<20)
	if res.StatusCode >= 400 {
		return DeviceStartResult{}, mapHTTP(res.StatusCode, body)
	}
	var parsed struct {
		DeviceCode              string `json:"device_code"`
		UserCode                string `json:"user_code"`
		VerificationURI         string `json:"verification_uri"`
		VerificationURIComplete string `json:"verification_uri_complete"`
		ExpiresIn               int    `json:"expires_in"`
		Interval                int    `json:"interval"`
		Error                   string `json:"error"`
		ErrorDescription        string `json:"error_description"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return DeviceStartResult{}, fmt.Errorf("解析设备码响应失败")
	}
	if parsed.Error != "" {
		return DeviceStartResult{}, &APIError{Code: CodeAuthRequired, Message: firstNonEmpty(parsed.ErrorDescription, parsed.Error)}
	}
	if parsed.DeviceCode == "" || parsed.UserCode == "" {
		return DeviceStartResult{}, fmt.Errorf("设备码响应不完整")
	}
	interval := parsed.Interval
	if interval < 5 {
		interval = 5
	}
	expiresIn := parsed.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 900
	}
	flowID := session.RandomURLSafe(16)
	uri := parsed.VerificationURI
	if uri == "" {
		uri = c.LoginBase + "/login/device"
	}
	flowCtx, cancel := context.WithCancel(context.Background())
	flow := &deviceFlow{
		DeviceCode:      parsed.DeviceCode,
		UserCode:        parsed.UserCode,
		VerificationURI: uri,
		Interval:        time.Duration(interval) * time.Second,
		ExpiresAt:       time.Now().Add(time.Duration(expiresIn) * time.Second),
		StartedAt:       time.Now(),
		Status:          "pending",
		Cancel:          cancel,
	}
	c.mu.Lock()
	c.flows[flowID] = flow
	c.mu.Unlock()
	go c.pollDeviceFlow(flowCtx, flowID)

	return DeviceStartResult{
		FlowID:          flowID,
		UserCode:        parsed.UserCode,
		VerificationURI: uri,
		ExpiresIn:       expiresIn,
		Interval:        interval,
	}, nil
}

func (c *Client) DeviceStatus(flowID string) (DeviceStatusResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	flow, ok := c.flows[flowID]
	if !ok {
		return DeviceStatusResult{}, &APIError{Code: CodeDeviceExpired, Message: "授权流程不存在或已结束"}
	}
	out := DeviceStatusResult{
		Status:       flow.Status,
		ErrorMessage: flow.ErrorMessage,
		AccountID:    flow.AccountID,
		Login:        flow.Login,
	}
	if flow.Status == "pending" {
		rem := int(time.Until(flow.ExpiresAt).Seconds())
		if rem < 0 {
			rem = 0
		}
		out.ExpiresIn = rem
	}
	return out, nil
}

func (c *Client) CancelDeviceFlow(flowID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if flow, ok := c.flows[flowID]; ok {
		if flow.Cancel != nil {
			flow.Cancel()
		}
		flow.Status = "denied"
		flow.ErrorMessage = "已取消"
		delete(c.flows, flowID)
	}
}

func (c *Client) pollDeviceFlow(ctx context.Context, flowID string) {
	for {
		c.mu.Lock()
		flow, ok := c.flows[flowID]
		if !ok {
			c.mu.Unlock()
			return
		}
		interval := flow.Interval
		deviceCode := flow.DeviceCode
		expiresAt := flow.ExpiresAt
		c.mu.Unlock()

		if time.Now().After(expiresAt) {
			c.finishFlow(flowID, "expired", "授权码已过期，请重新开始", "", "")
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}

		token, err := c.requestDeviceToken(ctx, deviceCode)
		if err != nil {
			var apiErr *APIError
			if AsAPIError(err, &apiErr) {
				switch apiErr.Code {
				case CodeDevicePending:
					continue
				case CodeDeviceSlowDown:
					c.mu.Lock()
					if f, ok := c.flows[flowID]; ok {
						f.Interval += 5 * time.Second
					}
					c.mu.Unlock()
					continue
				case CodeDeviceExpired:
					c.finishFlow(flowID, "expired", apiErr.Message, "", "")
					return
				case CodeDeviceDenied:
					c.finishFlow(flowID, "denied", apiErr.Message, "", "")
					return
				}
			}
			c.finishFlow(flowID, "error", err.Error(), "", "")
			return
		}

		user, err := c.GetUser(ctx, token.AccessToken)
		if err != nil {
			c.finishFlow(flowID, "error", err.Error(), "", "")
			return
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
			c.finishFlow(flowID, "error", "无法写入系统安全存储："+err.Error(), "", "")
			return
		}
		c.finishFlow(flowID, "complete", "", accountID, user.Login)
		return
	}
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
	TokenType    string `json:"token_type"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

func (c *Client) requestDeviceToken(ctx context.Context, deviceCode string) (tokenResponse, error) {
	form := url.Values{}
	form.Set("client_id", c.ClientID)
	form.Set("device_code", deviceCode)
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
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
	if parsed.Error != "" {
		switch parsed.Error {
		case "authorization_pending":
			return tokenResponse{}, &APIError{Code: CodeDevicePending, Message: "等待用户授权"}
		case "slow_down":
			return tokenResponse{}, &APIError{Code: CodeDeviceSlowDown, Message: "请求过快"}
		case "expired_token":
			return tokenResponse{}, &APIError{Code: CodeDeviceExpired, Message: "授权码已过期"}
		case "access_denied":
			return tokenResponse{}, &APIError{Code: CodeDeviceDenied, Message: "用户拒绝授权"}
		default:
			return tokenResponse{}, &APIError{Code: CodeAuthRequired, Message: firstNonEmpty(parsed.ErrorDesc, parsed.Error)}
		}
	}
	if parsed.AccessToken == "" {
		return tokenResponse{}, &APIError{Code: CodeAuthRequired, Message: "未获得访问令牌"}
	}
	return parsed, nil
}

func (c *Client) finishFlow(flowID, status, msg, accountID, login string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	flow, ok := c.flows[flowID]
	if !ok {
		return
	}
	flow.Status = status
	flow.ErrorMessage = msg
	flow.AccountID = accountID
	flow.Login = login
	if flow.Cancel != nil {
		flow.Cancel()
	}
	// Keep completed flows briefly so UI can poll the result, then drop.
	if status != "pending" {
		go func() {
			time.Sleep(2 * time.Minute)
			c.mu.Lock()
			delete(c.flows, flowID)
			c.mu.Unlock()
		}()
	}
}

// SetPAT validates a personal access token and stores it.
func (c *Client) SetPAT(ctx context.Context, token string) (User, string, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return User{}, "", &APIError{Code: CodeInvalidToken, Message: "请填写个人访问令牌"}
	}
	user, err := c.GetUser(ctx, token)
	if err != nil {
		return User{}, "", err
	}
	accountID := fmt.Sprintf("gh_%d", user.ID)
	secret := credentials.Secret{
		Kind:  credentials.KindPAT,
		Token: token,
		Login: user.Login,
	}
	if err := c.Creds.Set(accountID, secret); err != nil {
		return User{}, "", &APIError{Code: CodeAuthRequired, Message: "无法写入系统安全存储：" + err.Error()}
	}
	return user, accountID, nil
}

func (c *Client) GetUser(ctx context.Context, token string) (User, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.APIBase+"/user", nil)
	if err != nil {
		return User{}, err
	}
	c.authHeaders(req, token)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return User{}, mapTransport(err)
	}
	defer res.Body.Close()
	body, _ := readLimited(res.Body, 1<<20)
	if res.StatusCode >= 400 {
		return User{}, mapHTTP(res.StatusCode, body)
	}
	var user User
	if err := json.Unmarshal(body, &user); err != nil {
		return User{}, fmt.Errorf("解析用户信息失败")
	}
	if user.Login == "" || user.ID == 0 {
		return User{}, &APIError{Code: CodeInvalidToken, Message: "令牌无效"}
	}
	return user, nil
}

func (c *Client) GetToken(accountID string) (credentials.Secret, error) {
	secret, err := c.Creds.Get(accountID)
	if err != nil {
		if err == credentials.ErrNotFound {
			return credentials.Secret{}, &APIError{Code: CodeAuthRequired, Message: "尚未连接 GitHub 账号"}
		}
		return credentials.Secret{}, err
	}
	if secret.Expired(time.Now()) {
		if secret.RefreshToken != "" && c.WebOAuthConfigured() {
			refreshed, rerr := c.refreshToken(context.Background(), secret.RefreshToken)
			if rerr == nil {
				secret.Token = refreshed.AccessToken
				if refreshed.RefreshToken != "" {
					secret.RefreshToken = refreshed.RefreshToken
				}
				if refreshed.ExpiresIn > 0 {
					secret.ExpiresAt = time.Now().Add(time.Duration(refreshed.ExpiresIn) * time.Second)
				}
				_ = c.Creds.Set(accountID, secret)
				return secret, nil
			}
		}
		return credentials.Secret{}, &APIError{Code: CodeTokenExpired, Message: "GitHub 令牌已过期，请重新登录"}
	}
	return secret, nil
}

func (c *Client) refreshToken(ctx context.Context, refreshToken string) (tokenResponse, error) {
	form := url.Values{}
	form.Set("client_id", c.ClientID)
	if secret := c.clientSecret(); secret != "" {
		form.Set("client_secret", secret)
	}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)
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
		return tokenResponse{}, fmt.Errorf("刷新令牌失败")
	}
	if parsed.Error != "" || parsed.AccessToken == "" {
		return tokenResponse{}, &APIError{Code: CodeTokenExpired, Message: firstNonEmpty(parsed.ErrorDesc, "刷新令牌失败")}
	}
	return parsed, nil
}

func (c *Client) DeleteCredential(accountID string) error {
	err := c.Creds.Delete(accountID)
	if err == credentials.ErrNotFound {
		return nil
	}
	return err
}

func (c *Client) GetRepo(ctx context.Context, accountID, owner, repo string) (RepoInfo, error) {
	secret, err := c.GetToken(accountID)
	if err != nil {
		return RepoInfo{}, err
	}
	path := fmt.Sprintf("/repos/%s/%s", url.PathEscape(owner), url.PathEscape(repo))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.APIBase+path, nil)
	if err != nil {
		return RepoInfo{}, err
	}
	c.authHeaders(req, secret.Token)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return RepoInfo{}, mapTransport(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode >= 400 {
		return RepoInfo{}, mapHTTP(res.StatusCode, body)
	}
	var raw struct {
		FullName      string `json:"full_name"`
		Name          string `json:"name"`
		Private       bool   `json:"private"`
		DefaultBranch string `json:"default_branch"`
		CloneURL      string `json:"clone_url"`
		HTMLURL       string `json:"html_url"`
		Description   string `json:"description"`
		Owner         struct {
			Login string `json:"login"`
		} `json:"owner"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return RepoInfo{}, fmt.Errorf("解析仓库信息失败")
	}
	return RepoInfo{
		FullName:      raw.FullName,
		Name:          raw.Name,
		OwnerLogin:    raw.Owner.Login,
		Private:       raw.Private,
		DefaultBranch: raw.DefaultBranch,
		CloneURL:      raw.CloneURL,
		HTMLURL:       raw.HTMLURL,
		Description:   raw.Description,
	}, nil
}

func (c *Client) CreateRepo(ctx context.Context, accountID string, name, description string, private bool) (RepoInfo, error) {
	secret, err := c.GetToken(accountID)
	if err != nil {
		return RepoInfo{}, err
	}
	payload, _ := json.Marshal(map[string]any{
		"name":        name,
		"description": description,
		"private":     private,
		"auto_init":   false,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.APIBase+"/user/repos", strings.NewReader(string(payload)))
	if err != nil {
		return RepoInfo{}, err
	}
	c.authHeaders(req, secret.Token)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return RepoInfo{}, mapTransport(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode >= 400 {
		return RepoInfo{}, mapHTTP(res.StatusCode, body)
	}
	var raw struct {
		FullName      string `json:"full_name"`
		Name          string `json:"name"`
		Private       bool   `json:"private"`
		DefaultBranch string `json:"default_branch"`
		CloneURL      string `json:"clone_url"`
		HTMLURL       string `json:"html_url"`
		Description   string `json:"description"`
		Owner         struct {
			Login string `json:"login"`
		} `json:"owner"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return RepoInfo{}, fmt.Errorf("解析创建仓库响应失败")
	}
	return RepoInfo{
		FullName:      raw.FullName,
		Name:          raw.Name,
		OwnerLogin:    raw.Owner.Login,
		Private:       raw.Private,
		DefaultBranch: raw.DefaultBranch,
		CloneURL:      raw.CloneURL,
		HTMLURL:       raw.HTMLURL,
		Description:   raw.Description,
	}, nil
}

type ListedRepo struct {
	FullName      string `json:"fullName"`
	Name          string `json:"name"`
	OwnerLogin    string `json:"ownerLogin"`
	Private       bool   `json:"private"`
	DefaultBranch string `json:"defaultBranch"`
	CloneURL      string `json:"cloneUrl"`
	HTMLURL       string `json:"htmlUrl"`
	Description   string `json:"description"`
	UpdatedAt     string `json:"updatedAt"`
}

func (c *Client) ListRepos(ctx context.Context, accountID, query string, page, perPage int) ([]ListedRepo, error) {
	secret, err := c.GetToken(accountID)
	if err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 30
	}
	var endpoint string
	if strings.TrimSpace(query) == "" {
		endpoint = fmt.Sprintf("%s/user/repos?sort=updated&per_page=%d&page=%d", c.APIBase, perPage, page)
	} else {
		q := url.QueryEscape(query + " in:name fork:true")
		endpoint = fmt.Sprintf("%s/search/repositories?q=%s&per_page=%d&page=%d", c.APIBase, q, perPage, page)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	c.authHeaders(req, secret.Token)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, mapTransport(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode >= 400 {
		return nil, mapHTTP(res.StatusCode, body)
	}
	type repoJSON struct {
		FullName      string `json:"full_name"`
		Name          string `json:"name"`
		Private       bool   `json:"private"`
		DefaultBranch string `json:"default_branch"`
		CloneURL      string `json:"clone_url"`
		HTMLURL       string `json:"html_url"`
		Description   string `json:"description"`
		UpdatedAt     string `json:"updated_at"`
		Owner         struct {
			Login string `json:"login"`
		} `json:"owner"`
	}
	var items []repoJSON
	if strings.TrimSpace(query) == "" {
		if err := json.Unmarshal(body, &items); err != nil {
			return nil, fmt.Errorf("解析仓库列表失败")
		}
	} else {
		var search struct {
			Items []repoJSON `json:"items"`
		}
		if err := json.Unmarshal(body, &search); err != nil {
			return nil, fmt.Errorf("解析搜索结果失败")
		}
		items = search.Items
	}
	out := make([]ListedRepo, 0, len(items))
	for _, r := range items {
		out = append(out, ListedRepo{
			FullName:      r.FullName,
			Name:          r.Name,
			OwnerLogin:    r.Owner.Login,
			Private:       r.Private,
			DefaultBranch: r.DefaultBranch,
			CloneURL:      r.CloneURL,
			HTMLURL:       r.HTMLURL,
			Description:   r.Description,
			UpdatedAt:     r.UpdatedAt,
		})
	}
	return out, nil
}

func (c *Client) authHeaders(req *http.Request, token string) {
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", apiVersion)
	req.Header.Set("User-Agent", userAgent)
}

func mapTransport(err error) error {
	if err == nil {
		return nil
	}
	if ctxErr := context.Cause(context.Background()); false {
		_ = ctxErr
	}
	msg := err.Error()
	if strings.Contains(msg, "Timeout") || strings.Contains(msg, "deadline") {
		return &APIError{Code: CodeTimeout, Message: "连接 GitHub 超时"}
	}
	return &APIError{Code: CodeOffline, Message: "无法连接 GitHub，请检查网络"}
}

func mapHTTP(status int, body []byte) error {
	var parsed struct {
		Message string `json:"message"`
	}
	_ = json.Unmarshal(body, &parsed)
	msg := strings.TrimSpace(parsed.Message)
	switch status {
	case 401:
		return &APIError{Code: CodeInvalidToken, Message: firstNonEmpty(msg, "认证失败，请重新连接 GitHub"), Status: status}
	case 403:
		lower := strings.ToLower(msg)
		if strings.Contains(lower, "rate limit") {
			return &APIError{Code: CodeRateLimited, Message: "GitHub 请求过于频繁，请稍后再试", Status: status}
		}
		if strings.Contains(lower, "saml") || strings.Contains(lower, "sso") {
			return &APIError{Code: CodeSSO, Message: "该组织要求完成 SSO 授权后再访问", Status: status}
		}
		return &APIError{Code: CodePermissionDenied, Message: firstNonEmpty(msg, "没有足够的 GitHub 权限"), Status: status}
	case 404:
		return &APIError{Code: CodeRepositoryNotFound, Message: firstNonEmpty(msg, "找不到仓库或无权访问"), Status: status}
	default:
		return &APIError{Code: CodeAuthRequired, Message: firstNonEmpty(msg, fmt.Sprintf("GitHub 返回错误（%d）", status)), Status: status}
	}
}

func AsAPIError(err error, target **APIError) bool {
	if err == nil {
		return false
	}
	if e, ok := err.(*APIError); ok {
		*target = e
		return true
	}
	return false
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func readLimited(r io.Reader, limit int64) ([]byte, error) {
	return io.ReadAll(io.LimitReader(r, limit))
}
