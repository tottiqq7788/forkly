//go:build darwin

package darwin

import (
	"net"
	"os"
)

func writeStaleUnixSocket(path string) error {
	ln, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	// Close without removing to leave a stale socket inode path... on macOS
	// closing the listener removes the file. Recreate an unlinked-looking stale
	// file by writing a regular file that Dial will fail on, then Acquire should
	// remove and replace with a real listener.
	_ = ln.Close()
	_ = os.Remove(path)
	return os.WriteFile(path, []byte("stale"), 0o600)
}
