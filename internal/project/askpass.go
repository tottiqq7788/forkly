package project

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// AskPassPath resolves the forkly-askpass helper next to the main binary or in PATH.
func AskPassPath() string {
	names := []string{"forkly-askpass"}
	if runtime.GOOS == "windows" {
		names = []string{"forkly-askpass.exe"}
	}
	try := func(dir string) string {
		for _, name := range names {
			c := filepath.Join(dir, name)
			if st, err := os.Stat(c); err == nil && !st.IsDir() {
				return c
			}
		}
		return ""
	}
	exe, err := os.Executable()
	if err == nil {
		if p := try(filepath.Dir(exe)); p != "" {
			return p
		}
		// go run / unbundled: also look in <cwd>/bin beside a make build.
		if wd, err := os.Getwd(); err == nil {
			if p := try(filepath.Join(wd, "bin")); p != "" {
				return p
			}
		}
	}
	if p, err := exec.LookPath("forkly-askpass"); err == nil {
		return p
	}
	if runtime.GOOS == "windows" {
		if p, err := exec.LookPath("forkly-askpass.exe"); err == nil {
			return p
		}
	}
	return ""
}
