//go:build darwin

package darwin

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/forkly-app/forkly/internal/platform"
)

func shortRuntimeDir(t *testing.T) string {
	t.Helper()
	// macOS sun_path is short; avoid long testing.TempDir paths.
	dir, err := os.MkdirTemp("/tmp", "fk-si-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

func TestSingleInstanceSecondForwardsOpenFiles(t *testing.T) {
	dir := shortRuntimeDir(t)
	primary, err := NewSingleInstance(dir)
	if err != nil {
		t.Fatal(err)
	}
	acquired, err := primary.Acquire()
	if err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("primary should acquire")
	}
	defer primary.Release()

	var mu sync.Mutex
	var received []platform.InstanceMessage
	primary.Listen(func(msg platform.InstanceMessage) {
		mu.Lock()
		received = append(received, msg)
		mu.Unlock()
	})

	secondary, err := NewSingleInstance(dir)
	if err != nil {
		t.Fatal(err)
	}
	acquired, err = secondary.Acquire()
	if err != nil {
		t.Fatal(err)
	}
	if acquired {
		t.Fatal("secondary should not acquire")
	}

	msg := platform.InstanceMessage{
		Op:    platform.OpOpenFiles,
		Paths: []string{"/tmp/a.md", "/tmp/b with space.md"},
	}
	if err := secondary.NotifyExisting(msg); err != nil {
		t.Fatalf("notify: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(received)
		mu.Unlock()
		if n >= 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 message, got %d", len(received))
	}
	if received[0].Op != platform.OpOpenFiles {
		t.Fatalf("op=%q", received[0].Op)
	}
	if len(received[0].Paths) != 2 {
		t.Fatalf("paths=%v", received[0].Paths)
	}
}

func TestSingleInstanceBuffersBeforeListen(t *testing.T) {
	dir := shortRuntimeDir(t)
	primary, err := NewSingleInstance(dir)
	if err != nil {
		t.Fatal(err)
	}
	acquired, err := primary.Acquire()
	if err != nil || !acquired {
		t.Fatalf("acquire: acquired=%v err=%v", acquired, err)
	}
	defer primary.Release()

	secondary, err := NewSingleInstance(dir)
	if err != nil {
		t.Fatal(err)
	}
	if acquired, _ = secondary.Acquire(); acquired {
		t.Fatal("secondary should not acquire")
	}
	if err := secondary.NotifyExisting(platform.InstanceMessage{
		Op:    platform.OpOpenFiles,
		Paths: []string{"/tmp/early.md"},
	}); err != nil {
		t.Fatal(err)
	}

	// Give acceptLoop time to queue before Listen.
	time.Sleep(50 * time.Millisecond)

	var mu sync.Mutex
	var received []platform.InstanceMessage
	primary.Listen(func(msg platform.InstanceMessage) {
		mu.Lock()
		received = append(received, msg)
		mu.Unlock()
	})

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(received)
		mu.Unlock()
		if n >= 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 || received[0].Paths[0] != "/tmp/early.md" {
		t.Fatalf("expected drained early message, got %#v", received)
	}
}

func TestSingleInstanceRecoversStaleSocket(t *testing.T) {
	dir := shortRuntimeDir(t)
	sock := filepath.Join(dir, "forkly.sock")
	if err := writeStaleUnixSocket(sock); err != nil {
		t.Fatal(err)
	}

	si, err := NewSingleInstance(dir)
	if err != nil {
		t.Fatal(err)
	}
	acquired, err := si.Acquire()
	if err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("should recover from stale socket")
	}
	defer si.Release()
}
