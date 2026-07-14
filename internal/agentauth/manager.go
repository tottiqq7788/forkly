package agentauth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/credentials"
)

const (
	ScopeRead         = "read"
	ScopeFileWrite    = "file_write"
	ScopeProjectAdmin = "project_admin"
	ScopeCommit       = "commit"
	ScopeBranchWrite  = "branch_write"
	ScopeRemoteWrite  = "remote_write"
	ScopeAccountAdmin = "account_admin"
	ScopeUIControl    = "ui_control"
	ScopeFullControl  = "full_control"
)

var AllScopes = []string{
	ScopeRead, ScopeFileWrite, ScopeProjectAdmin, ScopeCommit,
	ScopeBranchWrite, ScopeRemoteWrite, ScopeAccountAdmin, ScopeUIControl,
}

var PresetScopes = map[string][]string{
	"readonly":  {ScopeRead},
	"collaborate": {
		ScopeRead, ScopeFileWrite, ScopeCommit, ScopeBranchWrite, ScopeRemoteWrite,
	},
	"full_control": append([]string{}, AllScopes...),
}

const (
	pairTTL         = 5 * time.Minute
	maxPendingPairs = 8
)

var (
	ErrNotFound       = errors.New("agent client not found")
	ErrPairNotFound   = errors.New("pairing request not found")
	ErrPairExpired    = errors.New("pairing request expired")
	ErrPairPending    = errors.New("pairing awaiting approval")
	ErrRateLimited    = errors.New("too many pairing attempts")
	ErrInvalidCode    = errors.New("invalid pairing code")
	ErrScopeDenied    = errors.New("missing required scope")
	ErrTokenMismatch  = errors.New("invalid agent token")
)

type PairingState string

const (
	PairPending  PairingState = "pending"
	PairApproved PairingState = "approved"
	PairDenied   PairingState = "denied"
	PairClaimed  PairingState = "claimed"
)

type PendingPair struct {
	ID         string       `json:"id"`
	UserCode   string       `json:"userCode"`
	ClientName string       `json:"clientName"`
	Preset     string       `json:"preset"`
	Scopes     []string     `json:"scopes"`
	State      PairingState `json:"state"`
	CreatedAt  time.Time    `json:"createdAt"`
	ExpiresAt  time.Time    `json:"expiresAt"`
	ClientID   string       `json:"clientId,omitempty"`
	tokenPlain   string // only while approved and unclaimed
	deviceSecret string // only known to the initiating CLI
}

type ClientView struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Scopes       []string   `json:"scopes"`
	Preset       string     `json:"preset,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	LastUsedAt   *time.Time `json:"lastUsedAt,omitempty"`
}

type AuthResult struct {
	ClientID string
	Name     string
	Scopes   []string
}

type Manager struct {
	mu       sync.Mutex
	store    *config.Store
	creds    credentials.Store
	pending  map[string]*PendingPair // by id
	byCode   map[string]string       // userCode -> id
	starts   []time.Time
}

func NewManager(store *config.Store, creds credentials.Store) *Manager {
	return &Manager{
		store:   store,
		creds:   creds,
		pending: map[string]*PendingPair{},
		byCode:  map[string]string{},
	}
}

func (m *Manager) StartPair(clientName, preset string, scopes []string) (*PendingPair, string, error) {
	clientName = strings.TrimSpace(clientName)
	if clientName == "" {
		clientName = "Cursor / Codex"
	}
	preset = strings.TrimSpace(preset)
	if preset == "" {
		preset = "collaborate"
	}
	resolved, ok := PresetScopes[preset]
	if !ok {
		if len(scopes) == 0 {
			return nil, "", fmt.Errorf("unknown preset %q", preset)
		}
		resolved = NormalizeScopes(scopes)
	} else if preset == "full_control" {
		resolved = append([]string{}, AllScopes...)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reapLocked(time.Now())
	now := time.Now()
	cutoff := now.Add(-time.Minute)
	fresh := m.starts[:0]
	for _, t := range m.starts {
		if t.After(cutoff) {
			fresh = append(fresh, t)
		}
	}
	m.starts = fresh
	if len(m.starts) >= 10 {
		return nil, "", ErrRateLimited
	}
	if len(m.pending) >= maxPendingPairs {
		return nil, "", ErrRateLimited
	}
	m.starts = append(m.starts, now)

	id, err := randomHex(8)
	if err != nil {
		return nil, "", err
	}
	code, err := randomUserCode()
	if err != nil {
		return nil, "", err
	}
	deviceSecret, err := randomHex(32)
	if err != nil {
		return nil, "", err
	}
	p := &PendingPair{
		ID:           id,
		UserCode:     code,
		ClientName:   clientName,
		Preset:       preset,
		Scopes:       resolved,
		State:        PairPending,
		CreatedAt:    now,
		ExpiresAt:    now.Add(pairTTL),
		deviceSecret: deviceSecret,
	}
	m.pending[id] = p
	m.byCode[code] = id
	return clonePair(p), deviceSecret, nil
}

func (m *Manager) Pending() []PendingPair {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reapLocked(time.Now())
	out := make([]PendingPair, 0, len(m.pending))
	for _, p := range m.pending {
		if p.State == PairPending {
			out = append(out, *clonePair(p))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

func (m *Manager) PairStatus(id string) (*PendingPair, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reapLocked(time.Now())
	p, ok := m.pending[id]
	if !ok {
		return nil, ErrPairNotFound
	}
	return clonePair(p), nil
}

func (m *Manager) Approve(id string, scopes []string) (*PendingPair, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reapLocked(time.Now())
	p, ok := m.pending[id]
	if !ok {
		return nil, ErrPairNotFound
	}
	if p.State != PairPending {
		return nil, fmt.Errorf("pairing is %s", p.State)
	}
	if len(scopes) > 0 {
		p.Scopes = NormalizeScopes(scopes)
		p.Preset = "custom"
	}
	clientID, err := randomHex(12)
	if err != nil {
		return nil, err
	}
	token, err := randomHex(32)
	if err != nil {
		return nil, err
	}
	hash := hashToken(token)
	now := time.Now()
	meta := config.AgentClientMeta{
		ID:        clientID,
		Name:      p.ClientName,
		Scopes:    append([]string{}, p.Scopes...),
		Preset:    p.Preset,
		TokenHash: hash,
		CreatedAt: now,
	}
	if err := m.store.Save(func(f *config.File) error {
		f.AgentClients = append(f.AgentClients, meta)
		return nil
	}); err != nil {
		return nil, err
	}
	if err := m.creds.Set(clientID, credentials.Secret{
		Kind:   credentials.KindPAT,
		Token:  token,
		Scopes: strings.Join(p.Scopes, " "),
		Login:  p.ClientName,
	}); err != nil {
		_ = m.store.Save(func(f *config.File) error {
			out := f.AgentClients[:0]
			for _, c := range f.AgentClients {
				if c.ID != clientID {
					out = append(out, c)
				}
			}
			f.AgentClients = out
			return nil
		})
		return nil, err
	}
	p.State = PairApproved
	p.ClientID = clientID
	p.tokenPlain = token
	return clonePair(p), nil
}

func (m *Manager) Deny(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.pending[id]
	if !ok {
		return ErrPairNotFound
	}
	p.State = PairDenied
	p.tokenPlain = ""
	return nil
}

// Claim returns the one-time agent token after approval.
// deviceSecret must match the value returned only by StartPair (not by status/pending).
func (m *Manager) Claim(id, userCode, deviceSecret string) (clientID, token string, scopes []string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reapLocked(time.Now())
	p, ok := m.pending[id]
	if !ok {
		return "", "", nil, ErrPairNotFound
	}
	if subtle.ConstantTimeCompare([]byte(strings.ToUpper(userCode)), []byte(strings.ToUpper(p.UserCode))) != 1 {
		return "", "", nil, ErrInvalidCode
	}
	if subtle.ConstantTimeCompare([]byte(deviceSecret), []byte(p.deviceSecret)) != 1 {
		return "", "", nil, ErrInvalidCode
	}
	switch p.State {
	case PairPending:
		return "", "", nil, ErrPairPending
	case PairDenied:
		return "", "", nil, fmt.Errorf("pairing denied")
	case PairClaimed:
		return "", "", nil, fmt.Errorf("pairing already claimed")
	case PairApproved:
		tok := p.tokenPlain
		p.tokenPlain = ""
		p.State = PairClaimed
		delete(m.byCode, p.UserCode)
		return p.ClientID, tok, append([]string{}, p.Scopes...), nil
	default:
		return "", "", nil, ErrPairNotFound
	}
}

func (m *Manager) ListClients() []ClientView {
	snap := m.store.Snapshot()
	out := make([]ClientView, 0, len(snap.AgentClients))
	for _, c := range snap.AgentClients {
		out = append(out, ClientView{
			ID: c.ID, Name: c.Name, Scopes: append([]string{}, c.Scopes...),
			Preset: c.Preset, CreatedAt: c.CreatedAt, LastUsedAt: c.LastUsedAt,
		})
	}
	return out
}

func (m *Manager) Revoke(clientID string) error {
	clientID = strings.TrimSpace(clientID)
	if clientID == "" {
		return ErrNotFound
	}
	found := false
	if err := m.store.Save(func(f *config.File) error {
		out := f.AgentClients[:0]
		for _, c := range f.AgentClients {
			if c.ID == clientID {
				found = true
				continue
			}
			out = append(out, c)
		}
		f.AgentClients = out
		return nil
	}); err != nil {
		return err
	}
	if !found {
		return ErrNotFound
	}
	_ = m.creds.Delete(clientID)
	return nil
}

func (m *Manager) Authenticate(token string) (AuthResult, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return AuthResult{}, ErrTokenMismatch
	}
	want := hashToken(token)
	snap := m.store.Snapshot()
	var meta *config.AgentClientMeta
	for i := range snap.AgentClients {
		c := &snap.AgentClients[i]
		if subtle.ConstantTimeCompare([]byte(c.TokenHash), []byte(want)) == 1 {
			meta = c
			break
		}
	}
	if meta == nil {
		return AuthResult{}, ErrTokenMismatch
	}
	secret, err := m.creds.Get(meta.ID)
	if err != nil {
		return AuthResult{}, ErrTokenMismatch
	}
	if subtle.ConstantTimeCompare([]byte(secret.Token), []byte(token)) != 1 {
		return AuthResult{}, ErrTokenMismatch
	}
	now := time.Now()
	_ = m.store.Save(func(f *config.File) error {
		for i := range f.AgentClients {
			if f.AgentClients[i].ID == meta.ID {
				t := now
				f.AgentClients[i].LastUsedAt = &t
				break
			}
		}
		return nil
	})
	return AuthResult{
		ClientID: meta.ID,
		Name:     meta.Name,
		Scopes:   append([]string{}, meta.Scopes...),
	}, nil
}

func HasScope(scopes []string, need string) bool {
	need = strings.TrimSpace(need)
	if need == "" {
		return true
	}
	for _, s := range scopes {
		if s == ScopeFullControl || s == need {
			return true
		}
	}
	// full_control is expanded on approval, but accept either form.
	if need != ScopeFullControl {
		for _, s := range scopes {
			if s == need {
				return true
			}
		}
	}
	return false
}

func RequireScopes(have []string, need ...string) error {
	for _, n := range need {
		if !HasScope(have, n) {
			return fmt.Errorf("%w: %s", ErrScopeDenied, n)
		}
	}
	return nil
}

func NormalizeScopes(in []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if s == ScopeFullControl {
			return append([]string{}, AllScopes...)
		}
		ok := false
		for _, a := range AllScopes {
			if a == s {
				ok = true
				break
			}
		}
		if !ok {
			continue
		}
		if _, exists := seen[s]; exists {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	if len(out) == 0 {
		return []string{ScopeRead}
	}
	return out
}

func (m *Manager) reapLocked(now time.Time) {
	for id, p := range m.pending {
		if now.After(p.ExpiresAt) || p.State == PairClaimed || p.State == PairDenied {
			if now.After(p.ExpiresAt) || p.State == PairDenied || p.State == PairClaimed {
				// Keep denied/claimed briefly only via expiry; remove expired always.
			}
		}
		if now.After(p.ExpiresAt) {
			delete(m.byCode, p.UserCode)
			delete(m.pending, id)
		}
	}
}

func clonePair(p *PendingPair) *PendingPair {
	if p == nil {
		return nil
	}
	cp := *p
	cp.Scopes = append([]string{}, p.Scopes...)
	cp.tokenPlain = ""
	cp.deviceSecret = ""
	return &cp
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func randomHex(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func randomUserCode() (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, 8)
	for i := range out {
		out[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(out[:4]) + "-" + string(out[4:]), nil
}

// MarshalPending is a helper for tests/debug.
func MarshalPending(p PendingPair) []byte {
	raw, _ := json.Marshal(p)
	return raw
}
