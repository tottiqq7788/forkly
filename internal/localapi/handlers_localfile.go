package localapi

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/forkly-app/forkly/internal/gitexec"
)

func (s *Server) handleLocalFiles(w http.ResponseWriter, r *http.Request) {
	if s.deps.LocalFiles == nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/local-api/v1/local-files/")
	rest = strings.Trim(rest, "/")
	if rest == "" {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	parts := strings.Split(rest, "/")
	fileID := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}
	switch action {
	case "":
		if r.Method != http.MethodGet {
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		meta, err := s.deps.LocalFiles.Get(fileID)
		if err != nil {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, meta)
	case "content":
		switch r.Method {
		case http.MethodGet, http.MethodHead:
			content, meta, err := s.deps.LocalFiles.ReadContent(r.Context(), fileID)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
			if content.Revision != "" {
				etag := `"` + content.Revision + `"`
				w.Header().Set("ETag", etag)
				if match := r.Header.Get("If-None-Match"); match != "" && match == etag {
					w.WriteHeader(http.StatusNotModified)
					return
				}
			}
			if r.Method == http.MethodHead {
				w.WriteHeader(http.StatusOK)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"fileId":          meta.FileID,
				"path":            content.Path,
				"name":            meta.Name,
				"displayPath":     meta.DisplayPath,
				"absPath":         meta.AbsPath,
				"parentName":      meta.ParentName,
				"source":          content.Source,
				"kind":            content.Kind,
				"mime":            content.Mime,
				"size":            content.Size,
				"content":         content.Content,
				"truncated":       content.Truncated,
				"message":         content.Message,
				"revision":        content.Revision,
				"editable":        content.Editable,
				"lineEnding":      content.LineEnding,
				"hasUtf8Bom":      content.HasUtf8Bom,
				"hasFinalNewline": content.HasFinalNewline,
			})
		case http.MethodPut:
			s.authWrite(s.handleLocalFilePutContent(fileID))(w, r)
		default:
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	case "asset":
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		rel := r.URL.Query().Get("path")
		if rel == "" {
			writeErr(w, http.StatusBadRequest, "缺少 path")
			return
		}
		mime, data, revision, err := s.deps.LocalFiles.ReadAsset(r.Context(), fileID, rel)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if revision != "" {
			etag := `"` + revision + `"`
			w.Header().Set("ETag", etag)
			if match := r.Header.Get("If-None-Match"); match != "" && match == etag {
				w.WriteHeader(http.StatusNotModified)
				return
			}
		}
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Type", mime)
			w.WriteHeader(http.StatusOK)
			return
		}
		gitexec.WriteAssetHTTP(w, mime, data, revision)
	case "assets":
		s.authWrite(s.handleLocalFilePostAssets(fileID))(w, r)
	case "open-relative":
		s.authWrite(s.handleLocalFileOpenRelative(fileID))(w, r)
	default:
		writeErr(w, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleLocalFilePutContent(fileID string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		var body struct {
			Content  string `json:"content"`
			Revision string `json:"revision"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeErr(w, http.StatusBadRequest, "请求无效")
			return
		}
		res, err := s.deps.LocalFiles.WriteContent(fileID, body.Content, body.Revision)
		if err != nil {
			var conflict *gitexec.ContentConflict
			if errors.As(err, &conflict) {
				writeJSON(w, http.StatusConflict, map[string]any{
					"error": "content_conflict",
					"code":  "content_conflict",
					"details": map[string]any{
						"path":             conflict.Path,
						"expectedRevision": conflict.ExpectedRevision,
						"currentRevision":  conflict.CurrentRevision,
					},
				})
				return
			}
			if errors.Is(err, gitexec.ErrNotEditable) {
				writeErr(w, http.StatusBadRequest, "文件不可编辑")
				return
			}
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, res)
	}
}

func (s *Server) handleLocalFilePostAssets(fileID string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		const maxMemory = 1 << 20
		if err := r.ParseMultipartForm(maxMemory); err != nil {
			writeErr(w, http.StatusBadRequest, "请求无效")
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			writeErr(w, http.StatusBadRequest, "缺少 file")
			return
		}
		defer file.Close()
		limited := io.LimitReader(file, gitexec.MaxAssetUploadBytes+1)
		data, err := io.ReadAll(limited)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "读取上传失败")
			return
		}
		if int64(len(data)) > gitexec.MaxAssetUploadBytes {
			writeErr(w, http.StatusBadRequest, "图片过大")
			return
		}
		name := ""
		if header != nil {
			name = header.Filename
		}
		res, err := s.deps.LocalFiles.WriteAsset(fileID, name, data)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, res)
	}
}

func (s *Server) handleLocalFileOpenRelative(fileID string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
		meta, err := s.deps.LocalFiles.OpenRelative(fileID, body.Path)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, meta)
	}
}
