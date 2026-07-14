//go:build !windows

package runtimeinfo

func processAliveWindows(pid int) bool {
	return false
}
