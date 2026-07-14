package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Version is the current config schema.
// v1: projects + identity + preferences
// v2: + GitHub account metadata + per-project remote link (no secrets)
// v3: + Agent CLI client metadata (token hashes only; secrets in keychain)
const Version = 3

type ProjectEntry struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Path     string    `json:"path"`
	AddedAt  time.Time `json:"addedAt"`
	OpenedAt time.Time `json:"openedAt"`
	// HideRules are glob patterns (one conceptually per line in UI).
	// nil means “never configured” and ResolvedHideRules returns the default;
	// an empty slice means the user cleared all rules.
	HideRules []string `json:"hideRules"`
	// Remote links this project to a managed GitHub remote (no tokens).
	// The actual remote URL lives in .git/config; this only records which remote
	// Forkly manages and the last successful metadata.
	Remote *RemoteLink `json:"remote,omitempty"`
}

// RemoteLink is non-secret metadata about a project's managed GitHub remote.
type RemoteLink struct {
	Provider   string     `json:"provider"`             // "github"
	RemoteName string     `json:"remoteName"`           // usually "origin"
	Owner      string     `json:"owner,omitempty"`
	Repo       string     `json:"repo,omitempty"`
	AccountID  string     `json:"accountId,omitempty"`  // credentials store key
	LinkedAt   time.Time  `json:"linkedAt,omitempty"`
	LastFetchAt *time.Time `json:"lastFetchAt,omitempty"`
}

// GitHubAccountMeta is non-secret account display info. Tokens live in Keychain.
type GitHubAccountMeta struct {
	AccountID string    `json:"accountId"`
	Login     string    `json:"login"`
	Name      string    `json:"name,omitempty"`
	AvatarURL string    `json:"avatarUrl,omitempty"`
	AuthKind  string    `json:"authKind"` // "oauth" | "pat"
	LinkedAt  time.Time `json:"linkedAt"`
}

// AgentClientMeta is non-secret metadata for a paired CLI/Agent client.
// The bearer token itself lives in the OS keychain under AgentServiceName.
type AgentClientMeta struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Scopes     []string   `json:"scopes"`
	Preset     string     `json:"preset,omitempty"`
	TokenHash  string     `json:"tokenHash"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
}

// DefaultHideRule hides common macOS Finder metadata files in the files tree.
const DefaultHideRule = "*.DS*"

// ResolvedHideRules returns patterns used when listing the files tree.
func (p ProjectEntry) ResolvedHideRules() []string {
	if p.HideRules == nil {
		return []string{DefaultHideRule}
	}
	return p.HideRules
}

type GitIdentity struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// Default placeholder identity written on first launch.
const (
	DefaultIdentityName  = "本机身份"
	DefaultIdentityEmail = "local@forkly.local"
)

// IdentityConfigured reports whether the user has set a real Git identity
// (not the built-in placeholder).
func IdentityConfigured(id GitIdentity) bool {
	name := strings.TrimSpace(id.Name)
	email := strings.TrimSpace(id.Email)
	if name == "" || email == "" {
		return false
	}
	if name == DefaultIdentityName && email == DefaultIdentityEmail {
		return false
	}
	return true
}

type Preferences struct {
	Theme            string `json:"theme"` // system | light | dark
	BackgroundChecks bool   `json:"backgroundChecks"`
}

type File struct {
	Version       int                 `json:"version"`
	Projects      []ProjectEntry      `json:"projects"`
	Identity      GitIdentity         `json:"identity"`
	Preferences   Preferences         `json:"preferences"`
	GitHubAccount *GitHubAccountMeta  `json:"githubAccount,omitempty"`
	AgentClients  []AgentClientMeta   `json:"agentClients,omitempty"`
}

type Store struct {
	mu   sync.RWMutex
	path string
	data File
}

func DefaultDataDir() (string, error) {
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Application Support", "Forkly"), nil
	case "windows":
		base, err := os.UserConfigDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(base, "Forkly"), nil
	default:
		base, err := os.UserConfigDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(base, "forkly"), nil
	}
}

func DefaultLogDir() (string, error) {
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Logs", "Forkly"), nil
	case "windows":
		base, err := os.UserCacheDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(base, "Forkly", "Logs"), nil
	default:
		base, err := os.UserCacheDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(base, "forkly", "logs"), nil
	}
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
	migrated := migrateFile(&s.data)
	if s.data.Preferences.Theme == "" {
		s.data.Preferences.Theme = "system"
	}
	if migrated {
		if err := s.saveLocked(); err != nil {
			return nil, fmt.Errorf("config migrate save failed: %w", err)
		}
	}
	return s, nil
}

// migrateFile upgrades older schemas in place. Returns true if a save is needed.
func migrateFile(f *File) bool {
	changed := false
	if f.Version == 0 {
		f.Version = 1
		changed = true
	}
	if f.Version < 2 {
		// v1 → v2: remote links and GitHub account are optional nils.
		f.Version = 2
		changed = true
	}
	if f.Version < 3 {
		if f.AgentClients == nil {
			f.AgentClients = []AgentClientMeta{}
		}
		f.Version = 3
		changed = true
	}
	if f.Version > Version {
		// Future schema: keep what we can; still mark current.
		f.Version = Version
		changed = true
	}
	return changed
}

func defaultFile() File {
	return File{
		Version:  Version,
		Projects: []ProjectEntry{},
		Identity: GitIdentity{
			Name:  DefaultIdentityName,
			Email: DefaultIdentityEmail,
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
	return cloneFile(s.data)
}

func cloneFile(src File) File {
	cp := src
	cp.Projects = make([]ProjectEntry, len(src.Projects))
	for i, p := range src.Projects {
		cp.Projects[i] = p
		if p.HideRules != nil {
			cp.Projects[i].HideRules = append([]string(nil), p.HideRules...)
		}
		if p.Remote != nil {
			r := *p.Remote
			if p.Remote.LastFetchAt != nil {
				t := *p.Remote.LastFetchAt
				r.LastFetchAt = &t
			}
			cp.Projects[i].Remote = &r
		}
	}
	if src.GitHubAccount != nil {
		a := *src.GitHubAccount
		cp.GitHubAccount = &a
	}
	if src.AgentClients != nil {
		cp.AgentClients = make([]AgentClientMeta, len(src.AgentClients))
		for i, c := range src.AgentClients {
			cp.AgentClients[i] = c
			if c.Scopes != nil {
				cp.AgentClients[i].Scopes = append([]string(nil), c.Scopes...)
			}
			if c.LastUsedAt != nil {
				t := *c.LastUsedAt
				cp.AgentClients[i].LastUsedAt = &t
			}
		}
	}
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
