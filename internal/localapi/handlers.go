package localapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/gitexec"
	"github.com/forkly-app/forkly/internal/project"
)

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	rt := s.deps.Git.Runtime()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"version": s.deps.Version,
		"git": map[string]any{
			"version": rt.Version,
			"bundled": rt.Bundled,
			"path":    rt.GitPath,
		},
	})
}

func (s *Server) handleClaim(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	next := r.URL.Query().Get("next")
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		next = "/"
	}
	sess, ok := s.deps.Sessions.ClaimOneTime(token)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "打开链接已失效，请从菜单栏重新打开控制台")
		return
	}
	s.deps.Sessions.SetCookies(w, sess)
	http.Redirect(w, r, next, http.StatusFound)
}

// handleDevLogin creates a local session without the menu-bar one-time link.
// It is only available when the server runs with DevMode=true.
func (s *Server) handleDevLogin(w http.ResponseWriter, r *http.Request) {
	if !s.deps.DevMode {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if existing, ok := s.deps.Sessions.FromRequest(r); ok {
		s.deps.Sessions.SetCookies(w, existing)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "csrf": existing.CSRF, "dev": true})
		return
	}
	sess := s.deps.Sessions.Create()
	s.deps.Sessions.SetCookies(w, sess)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "csrf": sess.CSRF, "dev": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	sess := r.Context().Value(sessionKey)
	snap := s.deps.Store.Snapshot()
	rt := s.deps.Git.Runtime()
	writeJSON(w, http.StatusOK, map[string]any{
		"session":     sess,
		"identity":    snap.Identity,
		"identityConfigured": config.IdentityConfigured(snap.Identity),
		"preferences": snap.Preferences,
		"git": map[string]any{
			"version": rt.Version,
			"bundled": rt.Bundled,
		},
		"csrfCookie": "forkly_csrf",
	})
}

func (s *Server) handleProjects(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.deps.Projects.List(r.Context())
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"projects": list})
	case http.MethodPost:
		s.authWrite(func(w http.ResponseWriter, r *http.Request) {
			var req project.AddRequest
			if err := decodeJSON(r, &req); err != nil {
				writeErr(w, http.StatusBadRequest, "请求无效")
				return
			}
			p, err := s.deps.Projects.Add(r.Context(), req)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
			if s.deps.Watcher != nil {
				_ = s.deps.Watcher.Watch(p.ID, p.Path)
			}
			writeJSON(w, http.StatusCreated, p)
		})(w, r)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleProjectInspect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		Path string `json:"path"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求无效")
		return
	}
	info, err := s.deps.Projects.Inspect(r.Context(), body.Path)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleProjectSub(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/local-api/v1/projects/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	id := parts[0]
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodDelete:
			s.authWrite(func(w http.ResponseWriter, r *http.Request) {
				if err := s.deps.Projects.Remove(id); err != nil {
					writeErr(w, http.StatusBadRequest, err.Error())
					return
				}
				if s.deps.Watcher != nil {
					s.deps.Watcher.Unwatch(id)
				}
				writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			})(w, r)
		case http.MethodGet:
			p, err := s.deps.Projects.Get(id)
			if err != nil {
				writeErr(w, http.StatusNotFound, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, p)
		default:
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}
	action := parts[1]
	p, err := s.deps.Projects.Get(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	switch action {
	case "status":
		s.deps.Projects.TouchOpened(id)
		st, err := s.deps.Git.Status(r.Context(), p.Path)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if s.deps.Watcher != nil {
			observed := s.deps.Watcher.ObservedRenames(id)
			pairs := make([]gitexec.RenamePair, 0, len(observed))
			for _, o := range observed {
				pairs = append(pairs, gitexec.RenamePair{Old: o.Old, New: o.New})
			}
			merged, used := gitexec.CoalesceObservedRenames(st.Files, pairs)
			usedKey := make(map[string]bool, len(used))
			for _, u := range used {
				usedKey[u.Old+"\x00"+u.New] = true
			}
			for _, o := range observed {
				if !usedKey[o.Old+"\x00"+o.New] {
					s.deps.Watcher.Forget(id, o.Old, o.New)
				}
			}
			st.Files = merged
		}
		writeJSON(w, http.StatusOK, st)
	case "diff":
		file := r.URL.Query().Get("path")
		if file == "" {
			writeErr(w, http.StatusBadRequest, "缺少 path")
			return
		}
		d, err := s.deps.Git.DiffFile(r.Context(), p.Path, file)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, d)
	case "tree":
		source, err := gitexec.ParseBrowseSource(r.URL.Query().Get("source"))
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		offset := 0
		if v := r.URL.Query().Get("offset"); v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				offset = n
			}
		}
		limit := 0
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				limit = n
			}
		}
		listing, err := s.deps.Git.ListTree(r.Context(), p.Path, source, r.URL.Query().Get("path"), offset, limit)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, listing)
	case "content":
		source, err := gitexec.ParseBrowseSource(r.URL.Query().Get("source"))
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		file := r.URL.Query().Get("path")
		if file == "" {
			writeErr(w, http.StatusBadRequest, "缺少 path")
			return
		}
		content, err := s.deps.Git.ReadContent(r.Context(), p.Path, source, file)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, content)
	case "commit":
		s.authWrite(s.handleCommit(id, p))(w, r)
	case "history":
		s.handleHistory(w, r, p)
	case "commits":
		if len(parts) < 3 {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		sha := parts[2]
		if len(parts) >= 4 && parts[3] == "diff" {
			file := r.URL.Query().Get("path")
			d, err := s.deps.Git.DiffCommitFile(r.Context(), p.Path, sha, file)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, d)
			return
		}
		c, files, err := s.deps.Git.CommitDetail(r.Context(), p.Path, sha)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"commit": c, "files": files})
	case "relocate":
		s.authWrite(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			var body struct {
				Path string `json:"path"`
			}
			if err := decodeJSON(r, &body); err != nil {
				writeErr(w, http.StatusBadRequest, "请求无效")
				return
			}
			if err := s.deps.Projects.Relocate(id, body.Path); err != nil {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
			updated, err := s.deps.Projects.Get(id)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			if s.deps.Watcher != nil {
				s.deps.Watcher.Unwatch(id)
				_ = s.deps.Watcher.Watch(id, updated.Path)
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "path": updated.Path})
		})(w, r)
	case "reveal":
		s.authWrite(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			if s.deps.Reveal == nil {
				writeErr(w, http.StatusNotImplemented, "不支持")
				return
			}
			if err := s.deps.Reveal.Reveal(p.Path); err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		})(w, r)
	default:
		writeErr(w, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleCommit(id string, p config.ProjectEntry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		var body struct {
			Paths       []string `json:"paths"`
			Message     string   `json:"message"`
			Fingerprint string   `json:"fingerprint"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeErr(w, http.StatusBadRequest, "请求无效")
			return
		}
		ident := s.deps.Store.Snapshot().Identity
		if !config.IdentityConfigured(ident) {
			writeErr(w, http.StatusBadRequest, "请先配置提交身份（名称与邮箱）")
			return
		}
		res, err := s.deps.Git.Commit(r.Context(), p.Path, gitexec.CommitRequest{
			Paths: body.Paths, Message: body.Message, Fingerprint: body.Fingerprint,
			AuthorName: ident.Name, AuthorEmail: ident.Email,
		})
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, res)
	}
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request, p config.ProjectEntry) {
	cursor := r.URL.Query().Get("cursor")
	pathFilter := r.URL.Query().Get("path")
	page, err := s.deps.Git.Log(r.Context(), p.Path, 50, cursor, pathFilter)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		snap := s.deps.Store.Snapshot()
		rt := s.deps.Git.Runtime()
		writeJSON(w, http.StatusOK, map[string]any{
			"identity":    snap.Identity,
			"preferences": snap.Preferences,
			"git":         map[string]any{"version": rt.Version, "bundled": rt.Bundled, "path": rt.GitPath},
			"configPath":  s.deps.Store.Path(),
			"logDir":      s.deps.Log.Dir(),
		})
	case http.MethodPut:
		s.authWrite(func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Identity    *config.GitIdentity `json:"identity"`
				Preferences *config.Preferences `json:"preferences"`
			}
			if err := decodeJSON(r, &body); err != nil {
				writeErr(w, http.StatusBadRequest, "请求无效")
				return
			}
			if body.Identity != nil {
				body.Identity.Name = strings.TrimSpace(body.Identity.Name)
				body.Identity.Email = strings.TrimSpace(body.Identity.Email)
				if body.Identity.Name == "" || body.Identity.Email == "" {
					writeErr(w, http.StatusBadRequest, "名称和邮箱不能为空")
					return
				}
			}
			err := s.deps.Store.Save(func(f *config.File) error {
				if body.Identity != nil {
					f.Identity = *body.Identity
				}
				if body.Preferences != nil {
					f.Preferences = *body.Preferences
				}
				return nil
			})
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		})(w, r)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleFolderDialog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.deps.Picker == nil {
		writeErr(w, http.StatusNotImplemented, "当前平台不支持文件夹选择")
		return
	}
	path, err := s.deps.Picker.PickFolder(r.Context(), "选择项目文件夹")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": path})
}
