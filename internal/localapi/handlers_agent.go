package localapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/forkly-app/forkly/internal/agentauth"
)

func (s *Server) handleAgentPairStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.deps.Agents == nil {
		writeErr(w, http.StatusServiceUnavailable, "Agent 授权服务不可用")
		return
	}
	var body struct {
		ClientName string   `json:"clientName"`
		Preset     string   `json:"preset"`
		Scopes     []string `json:"scopes"`
	}
	_ = decodeJSON(r, &body)
	p, deviceSecret, err := s.deps.Agents.StartPair(body.ClientName, body.Preset, body.Scopes)
	if err != nil {
		if errors.Is(err, agentauth.ErrRateLimited) {
			writeErrCode(w, http.StatusTooManyRequests, "配对请求过于频繁，请稍后再试", "rate_limited", nil)
			return
		}
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"pairId":       p.ID,
		"userCode":     p.UserCode,
		"deviceSecret": deviceSecret,
		"clientName":   p.ClientName,
		"preset":       p.Preset,
		"scopes":       p.Scopes,
		"expiresAt":    p.ExpiresAt.UTC().Format(time.RFC3339),
		"expiresIn":    int(time.Until(p.ExpiresAt).Seconds()),
	})
}

func (s *Server) handleAgentPairStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.deps.Agents == nil {
		writeErr(w, http.StatusServiceUnavailable, "Agent 授权服务不可用")
		return
	}
	id := r.URL.Query().Get("pairId")
	p, err := s.deps.Agents.PairStatus(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "找不到配对请求")
		return
	}
	// Intentionally omit userCode/deviceSecret: status is unauthenticated and must not
	// enable claim races for loopback observers.
	writeJSON(w, http.StatusOK, map[string]any{
		"pairId":     p.ID,
		"clientName": p.ClientName,
		"preset":     p.Preset,
		"scopes":     p.Scopes,
		"status":     p.State,
		"expiresAt":  p.ExpiresAt.UTC().Format(time.RFC3339),
		"clientId":   p.ClientID,
	})
}

func (s *Server) handleAgentPairClaim(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.deps.Agents == nil {
		writeErr(w, http.StatusServiceUnavailable, "Agent 授权服务不可用")
		return
	}
	var body struct {
		PairID       string `json:"pairId"`
		UserCode     string `json:"userCode"`
		DeviceSecret string `json:"deviceSecret"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求无效")
		return
	}
	clientID, token, scopes, err := s.deps.Agents.Claim(body.PairID, body.UserCode, body.DeviceSecret)
	if err != nil {
		switch {
		case errors.Is(err, agentauth.ErrPairPending):
			writeJSON(w, http.StatusOK, map[string]any{"status": "pending"})
		case errors.Is(err, agentauth.ErrPairNotFound):
			writeErr(w, http.StatusNotFound, "找不到配对请求")
		case errors.Is(err, agentauth.ErrInvalidCode):
			writeErr(w, http.StatusForbidden, "配对凭证不正确")
		default:
			writeErr(w, http.StatusConflict, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "approved",
		"clientId": clientID,
		"token":    token,
		"scopes":   scopes,
	})
}

func (s *Server) handleAgentPairPending(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.deps.Agents == nil {
		writeErr(w, http.StatusServiceUnavailable, "Agent 授权服务不可用")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"pending": s.deps.Agents.Pending()})
}

func (s *Server) handleAgentPairApprove(w http.ResponseWriter, r *http.Request) {
	s.authBrowserWrite(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if s.deps.Agents == nil {
			writeErr(w, http.StatusServiceUnavailable, "Agent 授权服务不可用")
			return
		}
		var body struct {
			PairID string   `json:"pairId"`
			Scopes []string `json:"scopes"`
		}
		if err := decodeJSON(r, &body); err != nil || body.PairID == "" {
			writeErr(w, http.StatusBadRequest, "缺少 pairId")
			return
		}
		p, err := s.deps.Agents.Approve(body.PairID, body.Scopes)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true, "pairId": p.ID, "clientId": p.ClientID, "status": p.State,
		})
	})(w, r)
}

func (s *Server) handleAgentPairDeny(w http.ResponseWriter, r *http.Request) {
	s.authBrowserWrite(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if s.deps.Agents == nil {
			writeErr(w, http.StatusServiceUnavailable, "Agent 授权服务不可用")
			return
		}
		var body struct {
			PairID string `json:"pairId"`
		}
		if err := decodeJSON(r, &body); err != nil || body.PairID == "" {
			writeErr(w, http.StatusBadRequest, "缺少 pairId")
			return
		}
		if err := s.deps.Agents.Deny(body.PairID); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})(w, r)
}

func (s *Server) handleAgentClients(w http.ResponseWriter, r *http.Request) {
	if s.deps.Agents == nil {
		writeErr(w, http.StatusServiceUnavailable, "Agent 授权服务不可用")
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/local-api/v1/agent/clients")
	path = strings.Trim(path, "/")
	if path == "" {
		if r.Method != http.MethodGet {
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.authBrowser(func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, map[string]any{"clients": s.deps.Agents.ListClients()})
		})(w, r)
		return
	}
	parts := strings.Split(path, "/")
	id := parts[0]
	revoke := func(w http.ResponseWriter, r *http.Request) {
		s.authBrowserWrite(func(w http.ResponseWriter, r *http.Request) {
			if err := s.deps.Agents.Revoke(id); err != nil {
				writeErr(w, http.StatusNotFound, "找不到授权客户端")
				return
			}
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		})(w, r)
	}
	if len(parts) == 2 && parts[1] == "revoke" && r.Method == http.MethodPost {
		revoke(w, r)
		return
	}
	if r.Method == http.MethodDelete {
		revoke(w, r)
		return
	}
	writeErr(w, http.StatusNotFound, "not found")
}
