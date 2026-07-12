package app

import (
	"path/filepath"
	"testing"
	"time"
)

func TestDedupeRecentMarkdownPaths(t *testing.T) {
	recentOpenMu.Lock()
	recentOpenPath = map[string]time.Time{}
	recentOpenMu.Unlock()

	p := filepath.Join(t.TempDir(), "a.md")
	first := dedupeRecentMarkdownPaths([]string{p})
	if len(first) != 1 || first[0] != p {
		t.Fatalf("first open: %#v", first)
	}
	second := dedupeRecentMarkdownPaths([]string{p, p})
	if len(second) != 0 {
		t.Fatalf("expected dedupe within window, got %#v", second)
	}

	recentOpenMu.Lock()
	recentOpenPath[p] = time.Now().Add(-3 * time.Second)
	recentOpenMu.Unlock()
	third := dedupeRecentMarkdownPaths([]string{p})
	if len(third) != 1 {
		t.Fatalf("expected reopen after window, got %#v", third)
	}
}
