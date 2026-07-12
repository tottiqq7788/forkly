package session

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"sync"
	"time"
)

const (
	CookieName = "forkly_session"
	CSRFHeader = "X-Forkly-CSRF"
	CSRFCookie = "forkly_csrf"
)

type Session struct {
	ID        string
	CSRF      string
	CreatedAt time.Time
	ExpiresAt time.Time
}

type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	ttl      time.Duration
}

func NewManager(ttl time.Duration) *Manager {
	if ttl <= 0 {
		ttl = 12 * time.Hour
	}
	m := &Manager{sessions: map[string]*Session{}, ttl: ttl}
	go m.reap()
	return m
}

func (m *Manager) Create() *Session {
	s := &Session{
		ID:        randomToken(32),
		CSRF:      randomToken(32),
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(m.ttl),
	}
	m.mu.Lock()
	m.sessions[s.ID] = s
	m.mu.Unlock()
	return s
}

func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[id]
	if !ok || time.Now().After(s.ExpiresAt) {
		return nil, false
	}
	return s, true
}

func (m *Manager) CreateOneTimeToken() (token string, claim func() (*Session, bool)) {
	token = randomToken(24)
	claimed := false
	var once sync.Mutex
	claim = func() (*Session, bool) {
		once.Lock()
		defer once.Unlock()
		if claimed {
			return nil, false
		}
		claimed = true
		return m.Create(), true
	}
	// Store pending claim briefly via map keyed by token.
	m.mu.Lock()
	m.sessions["ott:"+token] = &Session{
		ID:        "ott:" + token,
		ExpiresAt: time.Now().Add(2 * time.Minute),
	}
	m.mu.Unlock()
	return token, claim
}

func (m *Manager) ClaimOneTime(token string) (*Session, bool) {
	key := "ott:" + token
	m.mu.Lock()
	pending, ok := m.sessions[key]
	if !ok || time.Now().After(pending.ExpiresAt) {
		delete(m.sessions, key)
		m.mu.Unlock()
		return nil, false
	}
	delete(m.sessions, key)
	m.mu.Unlock()
	return m.Create(), true
}

func (m *Manager) SetCookies(w http.ResponseWriter, s *Session) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    s.ID,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  s.ExpiresAt,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     CSRFCookie,
		Value:    s.CSRF,
		Path:     "/",
		HttpOnly: false,
		SameSite: http.SameSiteLaxMode,
		Expires:  s.ExpiresAt,
	})
}

func (m *Manager) FromRequest(r *http.Request) (*Session, bool) {
	c, err := r.Cookie(CookieName)
	if err != nil {
		return nil, false
	}
	return m.Get(c.Value)
}

func (m *Manager) ValidateCSRF(r *http.Request, s *Session) bool {
	h := r.Header.Get(CSRFHeader)
	return h != "" && h == s.CSRF
}

func (m *Manager) reap() {
	t := time.NewTicker(10 * time.Minute)
	for range t.C {
		now := time.Now()
		m.mu.Lock()
		for k, s := range m.sessions {
			if now.After(s.ExpiresAt) {
				delete(m.sessions, k)
			}
		}
		m.mu.Unlock()
	}
}

func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func RandomURLSafe(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
