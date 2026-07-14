package runtimeinfo

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProcessAliveSelf(t *testing.T) {
	if !ProcessAlive(os.Getpid()) {
		t.Fatal("self should be alive")
	}
	if ProcessAlive(-1) || ProcessAlive(0) {
		t.Fatal("invalid pid")
	}
}

func TestWriteReadRemove(t *testing.T) {
	dir := t.TempDir()
	info, err := New("http://127.0.0.1:12345", "0.1.47")
	if err != nil {
		t.Fatal(err)
	}
	if err := Write(dir, info); err != nil {
		t.Fatal(err)
	}
	got, err := Read(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got.BaseURL != info.BaseURL || got.Nonce != info.Nonce || got.APIVersion != APIVersion {
		t.Fatalf("%+v", got)
	}
	st, err := os.Stat(Path(dir))
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm()&0o077 != 0 && filepath.Separator == '/' {
		// Best-effort permission check on unix-like systems.
		if st.Mode().Perm() != 0o600 {
			t.Fatalf("mode %v", st.Mode().Perm())
		}
	}
	if err := RemoveIfOwner(dir, info); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(dir); !os.IsNotExist(err) {
		t.Fatalf("expected removed, got %v", err)
	}
}

func TestRejectNonLoopback(t *testing.T) {
	if _, err := New("http://example.com:80", "1"); err == nil {
		t.Fatal("expected error")
	}
	dir := t.TempDir()
	if err := Write(dir, Info{BaseURL: "http://8.8.8.8:80", PID: 1, Nonce: "x", APIVersion: 1}); err == nil {
		t.Fatal("expected write error")
	}
}
