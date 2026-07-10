package config

import (
	"path/filepath"
	"testing"
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
