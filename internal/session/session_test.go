package session

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSessionCSRF(t *testing.T) {
	m := NewManager(time.Hour)
	s := m.Create()
	if s.ID == "" || s.CSRF == "" {
		t.Fatal("empty session")
	}
	rec := httptest.NewRecorder()
	m.SetCookies(rec, s)
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	for _, c := range rec.Result().Cookies() {
		req.AddCookie(c)
	}
	req.Header.Set(CSRFHeader, s.CSRF)
	got, ok := m.FromRequest(req)
	if !ok || got.ID != s.ID {
		t.Fatal("session not found")
	}
	if !m.ValidateCSRF(req, got) {
		t.Fatal("csrf failed")
	}
}

func TestOneTimeToken(t *testing.T) {
	m := NewManager(time.Hour)
	token, _ := m.CreateOneTimeToken()
	s, ok := m.ClaimOneTime(token)
	if !ok || s == nil {
		t.Fatal("claim failed")
	}
	if _, ok := m.ClaimOneTime(token); ok {
		t.Fatal("token should be single use")
	}
}
