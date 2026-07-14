package localapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/forkly-app/forkly/internal/cliinstall"
)

func (s *Server) handleLocalFileOpen(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.deps.LocalFiles == nil {
		writeErr(w, http.StatusServiceUnavailable, "本地文件服务不可用")
		return
	}
	var body struct {
		Path string `json:"path"`
	}
	if err := decodeJSON(r, &body); err != nil || strings.TrimSpace(body.Path) == "" {
		writeErr(w, http.StatusBadRequest, "请提供 path")
		return
	}
	path := strings.TrimSpace(body.Path)
	if !filepath.IsAbs(path) {
		cwd, err := os.Getwd()
		if err != nil {
			writeErr(w, http.StatusBadRequest, "无法解析相对路径")
			return
		}
		path = filepath.Join(cwd, path)
	}
	meta, err := s.deps.LocalFiles.Open(path)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, meta)
}

func (s *Server) handleCLIInstall(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.auth(func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, cliinstall.Status())
		})(w, r)
	case http.MethodPost:
		s.authBrowserWrite(func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Scope string `json:"scope"`
			}
			_ = decodeJSON(r, &body)
			res, err := cliinstall.Install(body.Scope)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, res)
		})(w, r)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
