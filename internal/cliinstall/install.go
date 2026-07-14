package cliinstall

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type Result struct {
	LinkPath   string `json:"linkPath"`
	SourcePath string `json:"sourcePath"`
	Scope      string `json:"scope"`
	Hint       string `json:"hint,omitempty"`
}

// LocateBundledCLI finds forklyctl next to the running Forkly binary.
func LocateBundledCLI() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(exe)
	name := "forklyctl"
	if runtime.GOOS == "windows" {
		name = "forklyctl.exe"
	}
	path := filepath.Join(dir, name)
	st, err := os.Stat(path)
	if err != nil || st.IsDir() {
		return "", fmt.Errorf("未找到打包的 forklyctl（期望路径 %s）", path)
	}
	return path, nil
}

func targetDir(scope string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(scope)) {
	case "", "user":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, ".local", "bin"), nil
	case "system":
		if runtime.GOOS == "windows" {
			return "", fmt.Errorf("Windows 请通过安装程序将 forklyctl 加入 PATH")
		}
		return "/usr/local/bin", nil
	default:
		return "", fmt.Errorf("未知安装范围 %q（可用 user|system）", scope)
	}
}

// Install creates a symlink (or copy on Windows) so `forklyctl` is on PATH.
func Install(scope string) (Result, error) {
	src, err := LocateBundledCLI()
	if err != nil {
		return Result{}, err
	}
	dir, err := targetDir(scope)
	if err != nil {
		return Result{}, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Result{}, err
	}
	name := "forklyctl"
	if runtime.GOOS == "windows" {
		name = "forklyctl.exe"
	}
	link := filepath.Join(dir, name)
	_ = os.Remove(link)
	if runtime.GOOS == "windows" {
		data, err := os.ReadFile(src)
		if err != nil {
			return Result{}, err
		}
		if err := os.WriteFile(link, data, 0o755); err != nil {
			return Result{}, err
		}
	} else {
		if err := os.Symlink(src, link); err != nil {
			return Result{}, fmt.Errorf("创建链接失败（%s）：%w", link, err)
		}
	}
	hint := ""
	if scope == "" || scope == "user" {
		hint = "请确认 ~/.local/bin 已加入 PATH"
	}
	return Result{LinkPath: link, SourcePath: src, Scope: scopeOrUser(scope), Hint: hint}, nil
}

func Status() map[string]any {
	src, srcErr := LocateBundledCLI()
	out := map[string]any{
		"bundledOK": srcErr == nil,
		"bundled":   src,
	}
	for _, scope := range []string{"user", "system"} {
		dir, err := targetDir(scope)
		if err != nil {
			continue
		}
		name := "forklyctl"
		if runtime.GOOS == "windows" {
			name = "forklyctl.exe"
		}
		link := filepath.Join(dir, name)
		st, err := os.Lstat(link)
		entry := map[string]any{"path": link, "present": err == nil}
		if err == nil && st.Mode()&os.ModeSymlink != 0 {
			if target, e := os.Readlink(link); e == nil {
				entry["target"] = target
			}
		}
		out[scope] = entry
	}
	return out
}

func scopeOrUser(scope string) string {
	if strings.TrimSpace(scope) == "" {
		return "user"
	}
	return scope
}
