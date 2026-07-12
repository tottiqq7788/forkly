package webui

import (
	"bytes"
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

//go:embed all:dist
var dist embed.FS

func Handler() http.Handler {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "web assets missing", http.StatusInternalServerError)
		})
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name == "" || name == "." {
			fileServer.ServeHTTP(w, r)
			return
		}

		if info, err := fs.Stat(sub, name); err == nil {
			if !info.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
			indexName := path.Join(name, "index.html")
			if _, err := fs.Stat(sub, indexName); err == nil {
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		base := path.Base(name)
		if strings.Contains(base, ".") {
			http.NotFound(w, r)
			return
		}

		serveIndexHTML(w, r, sub)
	})
}

func serveIndexHTML(w http.ResponseWriter, r *http.Request, sub fs.FS) {
	data, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		http.Error(w, "web assets missing", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(data))
}

func HasAssets() bool {
	entries, err := dist.ReadDir("dist")
	return err == nil && len(entries) > 0
}
