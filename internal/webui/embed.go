package webui

import (
	"embed"
	"io/fs"
	"net/http"
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
	return http.FileServer(http.FS(sub))
}

func HasAssets() bool {
	entries, err := dist.ReadDir("dist")
	return err == nil && len(entries) > 0
}
