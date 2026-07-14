package runtimeinfo

import (
	"errors"
	"os"
	"runtime"
	"syscall"
)

// ProcessAlive reports whether pid still refers to a live process.
// Best-effort: false negatives are preferred over trusting a stale discovery file.
func ProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	if runtime.GOOS == "windows" {
		return processAliveWindows(pid)
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = proc.Signal(syscall.Signal(0))
	if err == nil {
		return true
	}
	if errors.Is(err, os.ErrProcessDone) {
		return false
	}
	var errno syscall.Errno
	if errors.As(err, &errno) {
		if errno == syscall.ESRCH {
			return false
		}
		return true
	}
	return false
}
