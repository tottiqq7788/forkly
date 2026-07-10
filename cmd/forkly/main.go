package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/forkly-app/forkly/internal/app"
	"github.com/forkly-app/forkly/internal/diagnostics"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	log, err := diagnostics.NewLogger()
	if err != nil {
		fmt.Fprintf(os.Stderr, "forkly: init logger: %v\n", err)
		os.Exit(1)
	}
	defer log.Close()

	devMode := os.Getenv("FORKLY_DEV") == "1"
	serverOnly := os.Getenv("FORKLY_SERVER_ONLY") == "1" || devMode
	if serverOnly {
		listen := os.Getenv("FORKLY_LISTEN")
		if listen == "" && devMode {
			listen = "127.0.0.1:8787"
		}
		addr, shutdown, openURL, err := app.RunServerOnlyWith(ctx, log, app.ServerOnlyOptions{
			DataDir: os.Getenv("FORKLY_DATA_DIR"),
			Listen:  listen,
			DevMode: devMode,
		})
		if err != nil {
			log.Error("server-only failed", "err", err)
			os.Exit(1)
		}
		fmt.Println(addr)
		fmt.Println(openURL)
		if devMode {
			log.Info("dev mode enabled", "listen", addr, "vite", "http://127.0.0.1:5173/")
		}
		<-ctx.Done()
		_ = shutdown(context.Background())
		return
	}

	if err := app.Run(ctx, log); err != nil {
		log.Error("app exited", "err", err)
		os.Exit(1)
	}
}
