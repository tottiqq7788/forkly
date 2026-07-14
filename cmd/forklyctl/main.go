package main

import (
	"os"
	"strings"

	"github.com/forkly-app/forkly/internal/cli"
)

func main() {
	args := os.Args[1:]
	opts := cli.Options{}
	filtered := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--json" || a == "-j":
			opts.JSON = true
		case a == "--yes" || a == "-y":
			opts.Yes = true
		case strings.HasPrefix(a, "-") && a != "-" && !strings.HasPrefix(a, "--"):
			// leave unknown short flags for commands
			filtered = append(filtered, a)
		default:
			filtered = append(filtered, a)
		}
	}
	os.Exit(cli.Run(filtered, opts))
}
