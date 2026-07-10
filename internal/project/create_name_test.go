package project

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/gitexec"
)

func TestAddCreateRejectsPathTraversalName(t *testing.T) {
	store, err := config.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	rt, err := gitexec.DiscoverRuntime("")
	if err != nil {
		t.Skip(err)
	}
	svc := NewService(store, gitexec.NewExecutor(rt))
	parent := t.TempDir()
	ctx := context.Background()

	for _, name := range []string{"../escape", "..", ".", "a/b", `a\b`, "foo/../bar"} {
		_, err := svc.Add(ctx, AddRequest{Path: parent, Name: name, Create: true})
		if err == nil {
			t.Fatalf("expected reject for name %q", name)
		}
		escaped := filepath.Join(filepath.Dir(parent), "escape")
		if name == "../escape" {
			if _, statErr := os.Stat(escaped); !os.IsNotExist(statErr) {
				t.Fatalf("traversal should not create %s", escaped)
			}
		}
	}

	view, err := svc.Add(ctx, AddRequest{Path: parent, Name: "ok-project", Create: true})
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.EvalSymlinks(filepath.Join(parent, "ok-project"))
	if err != nil {
		t.Fatal(err)
	}
	if view.Path != want {
		t.Fatalf("path=%q want %q", view.Path, want)
	}
}
