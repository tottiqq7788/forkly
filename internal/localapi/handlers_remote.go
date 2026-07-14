package localapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/gitexec"
	gh "github.com/forkly-app/forkly/internal/github"
	"github.com/forkly-app/forkly/internal/operation"
	"github.com/forkly-app/forkly/internal/project"
)

func (s *Server) handleProjectRemote(w http.ResponseWriter, r *http.Request, id string, p config.ProjectEntry, parts []string) {
	if s.deps.Remotes == nil {
		writeErr(w, http.StatusServiceUnavailable, "远端服务不可用")
		return
	}
	if len(parts) == 2 {
		switch r.Method {
		case http.MethodGet:
			st, err := s.deps.Remotes.Status(r.Context(), id)
			if err != nil {
				writeRemoteErr(w, err)
				return
			}
			if s.deps.Ops != nil {
				if op := s.deps.Ops.ActiveForProject(id); op != nil {
					st.ActiveOp = op
				}
			}
			writeJSON(w, http.StatusOK, st)
		case http.MethodPut:
			s.authWrite(func(w http.ResponseWriter, r *http.Request) {
				var req project.LinkRemoteRequest
				if err := decodeJSON(r, &req); err != nil {
					writeErr(w, http.StatusBadRequest, "请求无效")
					return
				}
				st, err := s.deps.Remotes.Link(r.Context(), id, req)
				if err != nil {
					writeRemoteErr(w, err)
					return
				}
				writeJSON(w, http.StatusOK, st)
			})(w, r)
		case http.MethodDelete:
			s.authWrite(func(w http.ResponseWriter, r *http.Request) {
				var req project.UnlinkRemoteRequest
				_ = decodeJSON(r, &req)
				if err := s.deps.Remotes.Unlink(id, req.DeleteGitRemote); err != nil {
					writeRemoteErr(w, err)
					return
				}
				writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			})(w, r)
		default:
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}
	if len(parts) != 3 {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	action := parts[2]
	switch action {
	case "fetch", "pull", "push":
		s.authWrite(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			s.startRemoteOp(w, id, p.Path, action)
		})(w, r)
	case "create-repo":
		s.authWrite(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			var body struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				Private     bool   `json:"private"`
			}
			if err := decodeJSON(r, &body); err != nil {
				writeErr(w, http.StatusBadRequest, "请求无效")
				return
			}
			st, err := s.deps.Remotes.CreateGitHubRepo(r.Context(), id, body.Name, body.Description, body.Private)
			if err != nil {
				writeRemoteErr(w, err)
				return
			}
			writeJSON(w, http.StatusOK, st)
		})(w, r)
	default:
		writeErr(w, http.StatusNotFound, "not found")
	}
}

func (s *Server) startRemoteOp(w http.ResponseWriter, projectID, repoPath, kind string) {
	if s.deps.Ops == nil {
		writeErr(w, http.StatusServiceUnavailable, "任务服务不可用")
		return
	}
	op, ctx, err := s.deps.Ops.Start(kind, projectID, repoPath)
	if err != nil {
		var busy *operation.BusyError
		if errors.As(err, &busy) {
			writeErrCode(w, http.StatusConflict, "已有远端操作进行中", gitexec.ErrCodeOperationBusy, map[string]string{"operationId": busy.OpID})
			return
		}
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	go func() {
		s.deps.Ops.Update(op.ID, kind, 0.1, "进行中…")
		var runErr error
		switch kind {
		case "fetch":
			runErr = s.deps.Remotes.Fetch(ctx, projectID)
		case "pull":
			runErr = s.deps.Remotes.Pull(ctx, projectID)
		case "push":
			runErr = s.deps.Remotes.Push(ctx, projectID)
		}
		if ctx.Err() != nil {
			s.deps.Ops.Fail(op.ID, "已取消", "canceled")
			return
		}
		if runErr != nil {
			code, msg := classifyRemoteErr(runErr)
			s.deps.Ops.Fail(op.ID, msg, code)
			return
		}
		s.deps.Ops.Succeed(op.ID, "完成")
	}()
	writeJSON(w, http.StatusAccepted, map[string]any{"operationId": op.ID, "operation": op})
}

func (s *Server) handleOperations(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/local-api/v1/operations/")
	id = strings.Trim(id, "/")
	if id == "" {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		op, ok := s.deps.Ops.Get(id)
		if !ok {
			writeErr(w, http.StatusNotFound, "操作不存在")
			return
		}
		writeJSON(w, http.StatusOK, op)
	case http.MethodDelete:
		s.authWrite(func(w http.ResponseWriter, r *http.Request) {
			ok := s.deps.Ops.Cancel(id)
			writeJSON(w, http.StatusOK, map[string]bool{"ok": ok})
		})(w, r)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleProjectClone(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		URL        string `json:"url"`
		ParentPath string `json:"parentPath"`
		Name       string `json:"name"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求无效")
		return
	}
	if s.deps.Remotes == nil {
		writeErr(w, http.StatusServiceUnavailable, "远端服务不可用")
		return
	}
	p, err := s.deps.Remotes.CloneAndRegister(r.Context(), body.URL, body.ParentPath, body.Name)
	if err != nil {
		writeRemoteErr(w, err)
		return
	}
	if s.deps.Watcher != nil {
		_ = s.deps.Watcher.Watch(p.ID, p.Path)
	}
	writeJSON(w, http.StatusCreated, p)
}

func writeRemoteErr(w http.ResponseWriter, err error) {
	if err == nil {
		return
	}
	var conflict *project.ConflictError
	if errors.As(err, &conflict) {
		writeErrCode(w, http.StatusConflict, conflict.Message, gitexec.ErrCodeRemoteConflict, map[string]string{
			"existingUrl": conflict.ExistingURL,
		})
		return
	}
	if re := gitexec.AsRemoteError(err); re != nil {
		status := http.StatusBadRequest
		switch re.Code {
		case gitexec.ErrCodeAuthRequired, gitexec.ErrCodeTokenExpired:
			status = http.StatusUnauthorized
		case gitexec.ErrCodePermissionDenied:
			status = http.StatusForbidden
		case gitexec.ErrCodeRepositoryNotFound:
			status = http.StatusNotFound
		case gitexec.ErrCodeOffline, gitexec.ErrCodeTimeout:
			status = http.StatusServiceUnavailable
		case gitexec.ErrCodeOperationBusy, gitexec.ErrCodeRemoteConflict, gitexec.ErrCodeNonFastForward, gitexec.ErrCodeDiverged, gitexec.ErrCodeDirtyWorktree:
			status = http.StatusConflict
		}
		writeErrCode(w, status, re.Message, re.Code, nil)
		return
	}
	var apiErr *gh.APIError
	if gh.AsAPIError(err, &apiErr) {
		writeGitHubErr(w, err)
		return
	}
	writeErr(w, http.StatusBadRequest, err.Error())
}

func classifyRemoteErr(err error) (code, msg string) {
	if re := gitexec.AsRemoteError(err); re != nil {
		return re.Code, re.Message
	}
	var apiErr *gh.APIError
	if gh.AsAPIError(err, &apiErr) {
		return string(apiErr.Code), apiErr.Message
	}
	return "remote_failed", err.Error()
}
