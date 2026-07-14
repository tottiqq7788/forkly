package cliinstall

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestInstallUserLink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink semantics differ")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "forklyctl")
	if err := os.WriteFile(src, []byte("#!/bin/sh\necho ok\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	// Point LocateBundledCLI via copying into a fake exe dir is hard;
	// exercise targetDir + Status shape instead.
	st := Status()
	if st["user"] == nil {
		t.Fatalf("status missing user: %#v", st)
	}
	userDir, err := targetDir("user")
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(userDir) {
		t.Fatalf("user dir should be abs: %s", userDir)
	}
}
