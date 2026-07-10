package localapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/diagnostics"
	"github.com/forkly-app/forkly/internal/gitexec"
	"github.com/forkly-app/forkly/internal/platform"
	"github.com/forkly-app/forkly/internal/project"
	"github.com/forkly-app/forkly/internal/session"
	"github.com/forkly-app/forkly/internal/webui"
)

type Deps struct {
	Log      *diagnostics.Logger
	Store    *config.Store
	Git      *gitexec.Executor
	Projects *project.Service
	Sessions *session.Manager
	Picker   platform.FolderPicker
	Reveal   platform.RevealInFinder
	Version  string
}

type Server struct {
	deps   Deps
	ln     net.Listener
	srv    *http.Server
	addr   string
	cop    *http.CrossOriginProtection
}

func New(deps Deps) *Server {
	return &Server{deps: deps, cop: http.NewCrossOriginProtection()}
}

func (s *Server) Start() (string, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	s.ln = ln
	s.addr = "http://" + ln.Addr().String()
	_ = s.cop.AddTrustedOrigin(s.addr)

	mux := http.NewServeMux()
	mux.HandleFunc("/local-api/v1/health", s.handleHealth)
	mux.HandleFunc("/local-api/v1/session/claim", s.handleClaim)
	mux.HandleFunc("/local-api/v1/session/me", s.auth(s.handleMe))
	mux.HandleFunc("/local-api/v1/projects", s.auth(s.handleProjects))
	mux.HandleFunc("/local-api/v1/projects/", s.auth(s.handleProjectSub))
	mux.HandleFunc("/local-api/v1/settings", s.auth(s.handleSettings))
	mux.HandleFunc("/local-api/v1/dialog/folder", s.authWrite(s.handleFolderDialog))
	mux.HandleFunc("/local-api/v1/reveal", s.authWrite(s.handleReveal))
	mux.Handle("/", s.static())

	handler := s.securityHeaders(s.cop.Handler(mux))
	s.srv = &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := s.srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			s.deps.Log.Error("local server stopped", "err", err)
		}
	}()
	return s.addr, nil
}

func (s *Server) Addr() string { return s.addr }

func (s *Server) Shutdown(ctx context.Context) error {
	if s.srv == nil {
		return nil
	}
	return s.srv.Shutdown(ctx)
}

func (s *Server) OpenConsoleURL() string {
	token, _ := s.deps.Sessions.CreateOneTimeToken()
	// Store claimable token
	return fmt.Sprintf("%s/local-api/v1/session/claim?token=%s&next=/", s.addr, token)
}

func (s *Server) static() http.Handler {
	file := webui.Handler()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/local-api/") {
			http.NotFound(w, r)
			return
		}
		file.ServeHTTP(w, r)
	})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if host != "" && !strings.HasPrefix(host, "127.0.0.1") && !strings.HasPrefix(host, "localhost") {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

type ctxKey int

const sessionKey ctxKey = 1

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, ok := s.deps.Sessions.FromRequest(r)
		if !ok {
			writeErr(w, http.StatusUnauthorized, "未登录本地会话")
			return
		}
		ctx := context.WithValue(r.Context(), sessionKey, sess)
		next(w, r.WithContext(ctx))
	}
}

func (s *Server) authWrite(next http.HandlerFunc) http.HandlerFunc {
	return s.auth(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next(w, r)
			return
		}
		sess := r.Context().Value(sessionKey).(*session.Session)
		if !s.deps.Sessions.ValidateCSRF(r, sess) {
			writeErr(w, http.StatusForbidden, "CSRF 校验失败")
			return
		}
		next(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}
