package localapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/forkly-app/forkly/internal/config"
	gh "github.com/forkly-app/forkly/internal/github"
)

func (s *Server) handleGitHubSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		snap := s.deps.Store.Snapshot()
		out := map[string]any{
			"oauthConfigured": s.deps.GitHub != nil && s.deps.GitHub.OAuthConfigured(),
			"account":         nil,
		}
		if snap.GitHubAccount != nil {
			out["account"] = snap.GitHubAccount
		}
		writeJSON(w, http.StatusOK, out)
	case http.MethodDelete:
		s.authWrite(func(w http.ResponseWriter, r *http.Request) {
			snap := s.deps.Store.Snapshot()
			if snap.GitHubAccount != nil && s.deps.GitHub != nil {
				_ = s.deps.GitHub.DeleteCredential(snap.GitHubAccount.AccountID)
			}
			_ = s.deps.Store.Save(func(f *config.File) error {
				f.GitHubAccount = nil
				return nil
			})
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		})(w, r)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleGitHubDeviceStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.deps.GitHub == nil {
		writeErrCode(w, http.StatusServiceUnavailable, "GitHub 服务不可用", "offline", nil)
		return
	}
	res, err := s.deps.GitHub.StartDeviceFlow(r.Context())
	if err != nil {
		writeGitHubErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleGitHubDeviceStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	flowID := r.URL.Query().Get("flowId")
	if flowID == "" {
		writeErr(w, http.StatusBadRequest, "缺少 flowId")
		return
	}
	res, err := s.deps.GitHub.DeviceStatus(flowID)
	if err != nil {
		writeGitHubErr(w, err)
		return
	}
	if res.Status == "complete" && res.AccountID != "" {
		secret, tokErr := s.deps.GitHub.GetToken(res.AccountID)
		if tokErr != nil {
			writeGitHubErr(w, tokErr)
			return
		}
		user, userErr := s.deps.GitHub.GetUser(r.Context(), secret.Token)
		authKind := "oauth"
		_ = s.deps.Store.Save(func(f *config.File) error {
			meta := &config.GitHubAccountMeta{
				AccountID: res.AccountID,
				Login:     res.Login,
				AuthKind:  authKind,
				LinkedAt:  time.Now(),
			}
			if userErr == nil {
				meta.Name = user.Name
				meta.AvatarURL = user.AvatarURL
				if meta.Login == "" {
					meta.Login = user.Login
				}
			}
			f.GitHubAccount = meta
			return nil
		})
		if userErr == nil {
			res.Login = firstNonEmptyStr(res.Login, user.Login)
		}
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleGitHubDeviceCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		FlowID string `json:"flowId"`
	}
	if err := decodeJSON(r, &body); err != nil || body.FlowID == "" {
		writeErr(w, http.StatusBadRequest, "缺少 flowId")
		return
	}
	s.deps.GitHub.CancelDeviceFlow(body.FlowID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGitHubPAT(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求无效")
		return
	}
	user, accountID, err := s.deps.GitHub.SetPAT(r.Context(), body.Token)
	if err != nil {
		writeGitHubErr(w, err)
		return
	}
	meta := &config.GitHubAccountMeta{
		AccountID: accountID,
		Login:     user.Login,
		Name:      user.Name,
		AvatarURL: user.AvatarURL,
		AuthKind:  "pat",
		LinkedAt:  time.Now(),
	}
	_ = s.deps.Store.Save(func(f *config.File) error {
		f.GitHubAccount = meta
		return nil
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "account": meta})
}

func (s *Server) handleGitHubRepos(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	snap := s.deps.Store.Snapshot()
	if snap.GitHubAccount == nil {
		writeErrCode(w, http.StatusUnauthorized, "请先连接 GitHub 账号", string(gh.CodeAuthRequired), nil)
		return
	}
	q := r.URL.Query().Get("q")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	perPage, _ := strconv.Atoi(r.URL.Query().Get("perPage"))
	list, err := s.deps.GitHub.ListRepos(r.Context(), snap.GitHubAccount.AccountID, q, page, perPage)
	if err != nil {
		writeGitHubErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"repos": list})
}

func writeGitHubErr(w http.ResponseWriter, err error) {
	var apiErr *gh.APIError
	if gh.AsAPIError(err, &apiErr) {
		status := http.StatusBadRequest
		switch apiErr.Code {
		case gh.CodeAuthRequired, gh.CodeInvalidToken, gh.CodeTokenExpired:
			status = http.StatusUnauthorized
		case gh.CodePermissionDenied, gh.CodeSSO:
			status = http.StatusForbidden
		case gh.CodeRepositoryNotFound:
			status = http.StatusNotFound
		case gh.CodeRateLimited:
			status = http.StatusTooManyRequests
		case gh.CodeOffline, gh.CodeTimeout:
			status = http.StatusServiceUnavailable
		case gh.CodeConfigMissing:
			status = http.StatusNotImplemented
		}
		if apiErr.Status > 0 {
			status = apiErr.Status
		}
		writeErrCode(w, status, apiErr.Message, string(apiErr.Code), nil)
		return
	}
	writeErr(w, http.StatusBadRequest, err.Error())
}

func firstNonEmptyStr(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
