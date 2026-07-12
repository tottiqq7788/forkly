//go:build ignore

package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/forkly-app/forkly/internal/app"
	"github.com/forkly-app/forkly/internal/diagnostics"
)

// Tiny harness for editor smoke / white-screen repro.
// Prints: ADDR\nCLAIM_URL\nFILE_ID then serves until SIGINT.
func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: go run ./scripts/editor-smoke-server.go <markdown-path>")
		os.Exit(2)
	}
	mdPath, err := filepath.Abs(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	log, err := diagnostics.NewLogger()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer log.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dataDir := os.Getenv("FORKLY_DATA_DIR")
	if dataDir == "" {
		dataDir = filepath.Join(os.TempDir(), fmt.Sprintf("fk-editor-smoke-%d", time.Now().UnixNano()))
	}
	_ = os.MkdirAll(dataDir, 0o700)

	h, err := app.StartServerOnly(ctx, log, app.ServerOnlyOptions{
		DataDir: dataDir,
		Listen:  envOr("FORKLY_LISTEN", "127.0.0.1:0"),
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer h.Shutdown(context.Background())

	meta, err := h.LocalFiles.Open(mdPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "open markdown:", err)
		os.Exit(1)
	}
	next := "/editor/local/" + meta.FileID
	claim := h.OpenConsoleURLWithNext(next)
	fmt.Println(h.Addr)
	fmt.Println(claim)
	fmt.Println(meta.FileID)

	<-ctx.Done()
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
