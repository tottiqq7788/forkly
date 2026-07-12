//go:build darwin

package darwin

import (
	"sync"
	"testing"
	"time"
)

func TestInstallOpenFilesDelegateHook(t *testing.T) {
	if err := InstallOpenFilesDelegateHook(); err != nil {
		t.Fatalf("install hook: %v", err)
	}
	// Idempotent.
	if err := InstallOpenFilesDelegateHook(); err != nil {
		t.Fatalf("reinstall hook: %v", err)
	}
	if !systrayRespondsToOpenFiles() {
		t.Fatal("SystrayAppDelegate should respond to application:openFile(s): after hook")
	}
}

func TestOpenFilesWatcherBuffersThenDrainsOnce(t *testing.T) {
	openFilesMu.Lock()
	openFilesHandler = nil
	openFilesPending = nil
	openFilesMu.Unlock()

	paths := []string{
		"/tmp/hello world.md",
		"/tmp/中文文档.md",
		"/Users/test/notes/a.md",
	}
	invokeOpenFilesForTest(paths)

	openFilesMu.Lock()
	if len(openFilesPending) != 1 {
		openFilesMu.Unlock()
		t.Fatalf("expected 1 buffered batch, got %d", len(openFilesPending))
	}
	openFilesMu.Unlock()

	var mu sync.Mutex
	var got [][]string
	recv := OpenFilesReceiver{}
	if err := recv.StartOpenFilesWatcher(func(batch []string) {
		mu.Lock()
		got = append(got, append([]string{}, batch...))
		mu.Unlock()
	}); err != nil {
		t.Fatalf("start watcher: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(got)
		mu.Unlock()
		if n >= 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 {
		t.Fatalf("expected exactly one drained callback, got %d (%v)", len(got), got)
	}
	if len(got[0]) != len(paths) {
		t.Fatalf("path count: got %d want %d", len(got[0]), len(paths))
	}
	for i, p := range paths {
		if got[0][i] != p {
			t.Fatalf("path[%d]=%q want %q", i, got[0][i], p)
		}
	}
}
