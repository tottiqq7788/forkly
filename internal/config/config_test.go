package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestOpenAndSave(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	err = s.Save(func(f *File) error {
		f.Identity.Name = "Tester"
		f.Projects = append(f.Projects, ProjectEntry{ID: "1", Name: "p", Path: "/tmp/p"})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	s2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	snap := s2.Snapshot()
	if snap.Identity.Name != "Tester" || len(snap.Projects) != 1 {
		t.Fatalf("unexpected %+v", snap)
	}
	if snap.Version != Version {
		t.Fatalf("version=%d", snap.Version)
	}
	if filepath.Base(s2.Path()) != "config.json" {
		t.Fatal(s2.Path())
	}
}

func TestCorruptRecovery(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	if err := writeFile(path, []byte("{not json")); err != nil {
		t.Fatal(err)
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if s.Snapshot().Version != Version {
		t.Fatal("expected reset")
	}
}

func TestMigrateV1ToV2(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	v1 := map[string]any{
		"version":  1,
		"projects": []map[string]any{{"id": "a", "name": "n", "path": "/tmp/a"}},
		"identity": map[string]string{"name": "T", "email": "t@e.com"},
		"preferences": map[string]any{"theme": "dark", "backgroundChecks": true},
	}
	raw, _ := json.Marshal(v1)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	snap := s.Snapshot()
	if snap.Version != Version {
		t.Fatalf("want v%d, got %d", Version, snap.Version)
	}
	if snap.Preferences.Theme != "dark" || len(snap.Projects) != 1 {
		t.Fatalf("%+v", snap)
	}
}

func TestSnapshotDeepCopyRemote(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	err = s.Save(func(f *File) error {
		f.Projects = []ProjectEntry{{
			ID: "1", Name: "p", Path: "/tmp/p",
			Remote: &RemoteLink{
				Provider: "github", RemoteName: "origin",
				Owner: "o", Repo: "r", AccountID: "gh_1",
				LastFetchAt: &now,
			},
		}}
		f.GitHubAccount = &GitHubAccountMeta{AccountID: "gh_1", Login: "o", AuthKind: "pat"}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	snap := s.Snapshot()
	snap.Projects[0].Remote.Owner = "mutated"
	snap.GitHubAccount.Login = "mutated"
	raw := s.Snapshot()
	if raw.Projects[0].Remote.Owner != "o" {
		t.Fatal("snapshot leaked mutation")
	}
	if raw.GitHubAccount.Login != "o" {
		t.Fatal("account mutation leaked")
	}
}
