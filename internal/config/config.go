package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const Version = 1

type ProjectEntry struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	AddedAt   time.Time `json:"addedAt"`
	OpenedAt  time.Time `json:"openedAt"`
}

type GitIdentity struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type Preferences struct {
	Theme             string `json:"theme"` // system | light | dark
	BackgroundChecks  bool   `json:"backgroundChecks"`
}

type File struct {
	Version    int            `json:"version"`
	Projects   []ProjectEntry `json:"projects"`
	Identity   GitIdentity    `json:"identity"`
	Preferences Preferences   `json:"preferences"`
}

type Store struct {
	mu   sync.RWMutex
	path string
	data File
}

func DefaultDataDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "Application Support", "Forkly"), nil
}

func DefaultLogDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "Logs", "Forkly"), nil
}

func Open(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(dataDir, "config.json")
	s := &Store{path: path, data: defaultFile()}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		if err := s.saveLocked(); err != nil {
			return nil, err
		}
		return s, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &s.data); err != nil {
		backup := path + ".corrupt." + time.Now().Format("20060102-150405")
		_ = os.WriteFile(backup, raw, 0o600)
		s.data = defaultFile()
		if err := s.saveLocked(); err != nil {
			return nil, fmt.Errorf("config corrupt, backup %s, reset failed: %w", backup, err)
		}
		return s, nil
	}
	if s.data.Version == 0 {
		s.data.Version = Version
	}
	if s.data.Preferences.Theme == "" {
		s.data.Preferences.Theme = "system"
	}
	return s, nil
}

func defaultFile() File {
	return File{
		Version: Version,
		Projects: []ProjectEntry{},
		Identity: GitIdentity{
			Name:  "本机身份",
			Email: "local@forkly.local",
		},
		Preferences: Preferences{
			Theme:            "system",
			BackgroundChecks: true,
		},
	}
}

func (s *Store) Snapshot() File {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cp := s.data
	cp.Projects = append([]ProjectEntry(nil), s.data.Projects...)
	return cp
}

func (s *Store) Save(mutate func(*File) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := mutate(&s.data); err != nil {
		return err
	}
	return s.saveLocked()
}

func (s *Store) Path() string {
	return s.path
}

func (s *Store) saveLocked() error {
	s.data.Version = Version
	raw, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
