package localapi

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/forkly-app/forkly/internal/config"
	gh "github.com/forkly-app/forkly/internal/github"
)

func (s *Server) handleGitHubOAuthStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.deps.GitHub == nil {
		writeErr(w, http.StatusServiceUnavailable, "GitHub 服务不可用")
		return
	}
	if !s.deps.GitHub.WebOAuthConfigured() {
		writeGitHubErr(w, &gh.APIError{Code: gh.CodeConfigMissing, Message: "未配置 GitHub Web OAuth"})
		return
	}
	var body struct {
		ProjectID string `json:"projectId"`
		ReturnTo  string `json:"returnTo"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求无效")
		return
	}
	returnTo, err := s.validateOAuthReturnTo(body.ReturnTo)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	redirectURI := s.oauthCallbackURL()
	start, err := s.deps.GitHub.StartWebOAuth(r.Context(), redirectURI, body.ProjectID, returnTo)
	if err != nil {
		writeGitHubErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, start)
}

func (s *Server) handleGitHubOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	w.Header().Set("Referrer-Policy", "no-referrer")

	q := r.URL.Query()
	state := strings.TrimSpace(q.Get("state"))
	if errMsg := strings.TrimSpace(q.Get("error")); errMsg != "" {
		desc := strings.TrimSpace(q.Get("error_description"))
		returnTo := ""
		if s.deps.GitHub != nil {
			returnTo = s.deps.GitHub.DropWebOAuthFlow(state)
		}
		s.redirectOAuthResult(w, r, returnTo, "denied", "skipped", firstOAuthMessage(desc, errMsg, "授权已取消"))
		return
	}
	if s.deps.GitHub == nil {
		s.redirectOAuthResult(w, r, "", "error", "skipped", "GitHub 服务不可用")
		return
	}

	code := strings.TrimSpace(q.Get("code"))
	redirectURI := s.oauthCallbackURL()
	result, err := s.deps.GitHub.CompleteWebOAuth(r.Context(), code, state, redirectURI)
	if err != nil {
		s.redirectOAuthResult(w, r, result.ReturnTo, "error", "skipped", safeOAuthMessage(err))
		return
	}

	now := time.Now()
	if err := s.deps.Store.Save(func(f *config.File) error {
		f.GitHubAccount = &config.GitHubAccountMeta{
			AccountID: result.AccountID,
			Login:     result.User.Login,
			Name:      result.User.Name,
			AvatarURL: result.User.AvatarURL,
			AuthKind:  "oauth",
			LinkedAt:  now,
		}
		return nil
	}); err != nil {
		_ = s.deps.GitHub.DeleteCredential(result.AccountID)
		s.redirectOAuthResult(w, r, result.ReturnTo, "error", "skipped", "无法保存 GitHub 账号")
		return
	}

	linkStatus := "skipped"
	linkMessage := ""
	fetchStarted := false
	if result.ProjectID != "" && s.deps.Remotes != nil {
		if _, err := s.deps.Remotes.LinkExistingStrict(r.Context(), result.ProjectID); err != nil {
			linkStatus = "failed"
			linkMessage = safeOAuthMessage(err)
		} else {
			linkStatus = "linked"
			if p, err := s.deps.Projects.Get(result.ProjectID); err == nil {
				fetchStarted = s.startBackgroundRemoteFetch(result.ProjectID, p.Path)
			}
		}
	}

	returnTo := result.ReturnTo
	if returnTo == "" {
		if result.ProjectID != "" {
			returnTo = s.frontendOrigin() + "/projects/" + url.PathEscape(result.ProjectID)
		} else {
			returnTo = s.frontendOrigin() + "/settings"
		}
	}
	target := appendOAuthResultParams(returnTo, "ok", linkStatus, linkMessage, fetchStarted)
	http.Redirect(w, r, target, http.StatusSeeOther)
}

func (s *Server) oauthCallbackURL() string {
	return strings.TrimRight(s.addr, "/") + "/local-api/v1/github/oauth/callback"
}

func (s *Server) frontendOrigin() string {
	if s.deps.DevMode {
		return "http://127.0.0.1:5173"
	}
	return strings.TrimRight(s.addr, "/")
}

func (s *Server) validateOAuthReturnTo(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	if strings.Contains(raw, "://") {
		u, err := url.Parse(raw)
		if err != nil {
			return "", err
		}
		if !s.trustedOAuthOrigin(u.Scheme + "://" + u.Host) {
			return "", errOAuthReturnTo
		}
		if !strings.HasPrefix(u.Path, "/") || strings.HasPrefix(u.Path, "//") {
			return "", errOAuthReturnTo
		}
		return oauthReturnURL(u.Scheme+"://"+u.Host, u.Path, u.RawQuery), nil
	}
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") {
		return "", errOAuthReturnTo
	}
	return strings.TrimRight(s.frontendOrigin(), "/") + raw, nil
}

func oauthReturnURL(origin, path, rawQuery string) string {
	out := strings.TrimRight(origin, "/") + path
	if rawQuery != "" {
		out += "?" + rawQuery
	}
	return out
}

var errOAuthReturnTo = &oauthReturnToError{}

type oauthReturnToError struct{}

func (e *oauthReturnToError) Error() string { return "返回地址无效" }

func (s *Server) trustedOAuthOrigin(origin string) bool {
	origin = strings.TrimRight(strings.TrimSpace(origin), "/")
	if origin == strings.TrimRight(s.addr, "/") {
		return true
	}
	if s.deps.DevMode {
		switch origin {
		case "http://127.0.0.1:5173", "http://localhost:5173":
			return true
		}
	}
	return false
}

func (s *Server) redirectOAuthResult(w http.ResponseWriter, r *http.Request, returnTo, oauthStatus, linkStatus, message string) {
	if strings.TrimSpace(returnTo) == "" {
		returnTo = s.frontendOrigin() + "/settings"
	}
	target := appendOAuthResultParams(returnTo, oauthStatus, linkStatus, message, false)
	http.Redirect(w, r, target, http.StatusSeeOther)
}

func appendOAuthResultParams(returnTo, oauthStatus, linkStatus, message string, fetchStarted bool) string {
	u, err := url.Parse(returnTo)
	if err != nil {
		return returnTo
	}
	q := u.Query()
	q.Set("gh_oauth", oauthStatus)
	q.Set("gh_link", linkStatus)
	if strings.TrimSpace(message) != "" {
		q.Set("gh_msg", message)
	}
	if fetchStarted {
		q.Set("gh_fetch", "1")
	}
	u.RawQuery = q.Encode()
	return u.String()
}

func safeOAuthMessage(err error) string {
	if err == nil {
		return ""
	}
	var apiErr *gh.APIError
	if gh.AsAPIError(err, &apiErr) && apiErr.Message != "" {
		return apiErr.Message
	}
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		return "操作失败"
	}
	if len(msg) > 200 {
		return msg[:200]
	}
	return msg
}

func firstOAuthMessage(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return "授权失败"
}

func (s *Server) startBackgroundRemoteFetch(projectID, repoPath string) bool {
	if s.deps.Ops == nil || s.deps.Remotes == nil {
		return false
	}
	op, ctx, err := s.deps.Ops.Start("fetch", projectID, repoPath)
	if err != nil {
		return false
	}
	go func() {
		s.deps.Ops.Update(op.ID, "fetch", 0.1, "进行中…")
		if err := s.deps.Remotes.Fetch(ctx, projectID); err != nil {
			code, msg := classifyRemoteErr(err)
			s.deps.Ops.Fail(op.ID, msg, code)
			return
		}
		if ctx.Err() != nil {
			s.deps.Ops.Fail(op.ID, "已取消", "canceled")
			return
		}
		s.deps.Ops.Succeed(op.ID, "完成")
	}()
	return true
}
