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

	if os.Getenv("FORKLY_SERVER_ONLY") == "1" {
		addr, shutdown, openURL, err := app.RunServerOnly(ctx, log, os.Getenv("FORKLY_DATA_DIR"))
		if err != nil {
			log.Error("server-only failed", "err", err)
			os.Exit(1)
		}
		fmt.Println(addr)
		fmt.Println(openURL)
		<-ctx.Done()
		_ = shutdown(context.Background())
		return
	}

	if err := app.Run(ctx, log); err != nil {
		log.Error("app exited", "err", err)
		os.Exit(1)
	}
}
