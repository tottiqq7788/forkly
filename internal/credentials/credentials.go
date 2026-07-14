package credentials

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const ServiceName = "app.forkly.desktop.github"
const AgentServiceName = "app.forkly.desktop.agent"

// ErrNotFound means no credential exists for the given account.
var ErrNotFound = errors.New("credential not found")

// ErrUnavailable means the OS credential store cannot be used.
var ErrUnavailable = errors.New("credential store unavailable")

// Kind identifies how the token was obtained.
type Kind string

const (
	KindOAuth Kind = "oauth"
	KindPAT   Kind = "pat"
)

// Secret is the confidential payload stored in the OS keychain.
// It must never be written to config.json, logs, or API responses.
type Secret struct {
	Kind         Kind      `json:"kind"`
	Token        string    `json:"token"`
	RefreshToken string    `json:"refreshToken,omitempty"`
	ExpiresAt    time.Time `json:"expiresAt,omitempty"`
	Scopes       string    `json:"scopes,omitempty"`
	Login        string    `json:"login,omitempty"`
}

// Store persists GitHub credentials outside the project tree.
type Store interface {
	Set(accountID string, secret Secret) error
	Get(accountID string) (Secret, error)
	Delete(accountID string) error
}

func encodeSecret(s Secret) (string, error) {
	s.Token = strings.TrimSpace(s.Token)
	s.RefreshToken = strings.TrimSpace(s.RefreshToken)
	if s.Token == "" {
		return "", fmt.Errorf("token empty")
	}
	if s.Kind == "" {
		s.Kind = KindPAT
	}
	raw, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func decodeSecret(raw string) (Secret, error) {
	var s Secret
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return Secret{}, err
	}
	if strings.TrimSpace(s.Token) == "" {
		return Secret{}, fmt.Errorf("token empty")
	}
	return s, nil
}

// Expired reports whether an OAuth token has a known expiry in the past.
func (s Secret) Expired(now time.Time) bool {
	if s.ExpiresAt.IsZero() {
		return false
	}
	return !s.ExpiresAt.After(now)
}
