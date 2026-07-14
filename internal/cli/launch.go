package cli

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// LaunchDesktop starts the packaged Forkly app if possible.
func LaunchDesktop() error {
	switch runtime.GOOS {
	case "darwin":
		candidates := []string{
			"/Applications/Forkly.app",
			filepath.Join(os.Getenv("HOME"), "Applications", "Forkly.app"),
		}
		for _, app := range candidates {
			if st, err := os.Stat(app); err == nil && st.IsDir() {
				return exec.Command("open", "-a", app).Start()
			}
		}
		// Dev fallback: sibling forkly binary
		if exe, err := os.Executable(); err == nil {
			sibling := filepath.Join(filepath.Dir(exe), "forkly")
			if st, err := os.Stat(sibling); err == nil && !st.IsDir() {
				return exec.Command(sibling).Start()
			}
		}
		return exec.Command("open", "-a", "Forkly").Start()
	case "windows":
		local := os.Getenv("LOCALAPPDATA")
		candidates := []string{
			filepath.Join(local, "Programs", "Forkly", "Forkly.exe"),
		}
		for _, p := range candidates {
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return exec.Command(p).Start()
			}
		}
		return fmt.Errorf("未找到 Forkly.exe")
	default:
		if exe, err := os.Executable(); err == nil {
			sibling := filepath.Join(filepath.Dir(exe), "forkly")
			if st, err := os.Stat(sibling); err == nil && !st.IsDir() {
				return exec.Command(sibling).Start()
			}
		}
		return fmt.Errorf("请先手动启动 Forkly")
	}
}

func FindInstallHint() string {
	switch runtime.GOOS {
	case "darwin":
		return "/Applications/Forkly.app/Contents/MacOS/forklyctl"
	case "windows":
		return `%LOCALAPPDATA%\Programs\Forkly\forklyctl.exe`
	default:
		return "forklyctl"
	}
}

func DefaultEnsureTimeout() time.Duration { return 30 * time.Second }

func SplitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
