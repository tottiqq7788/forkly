package agentauth

import (
	"testing"
	"time"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/credentials"
)

func TestPairApproveClaimRevoke(t *testing.T) {
	dir := t.TempDir()
	store, err := config.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	creds := credentials.NewMemoryStore()
	m := NewManager(store, creds)

	p, secret, err := m.StartPair("Codex", "collaborate", nil)
	if err != nil {
		t.Fatal(err)
	}
	if p.UserCode == "" || p.State != PairPending || secret == "" {
		t.Fatalf("%+v secret=%q", p, secret)
	}
	if _, _, _, err := m.Claim(p.ID, p.UserCode, secret); err != ErrPairPending {
		t.Fatalf("claim before approve: %v", err)
	}
	if _, err := m.Approve(p.ID, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := m.Claim(p.ID, p.UserCode, "wrong-secret"); err != ErrInvalidCode {
		t.Fatalf("claim with wrong device secret: %v", err)
	}
	clientID, token, scopes, err := m.Claim(p.ID, p.UserCode, secret)
	if err != nil || clientID == "" || token == "" || len(scopes) == 0 {
		t.Fatalf("%v %s %s %v", err, clientID, token, scopes)
	}
	auth, err := m.Authenticate(token)
	if err != nil {
		t.Fatal(err)
	}
	if auth.ClientID != clientID {
		t.Fatalf("%+v", auth)
	}
	if err := RequireScopes(auth.Scopes, ScopeRead, ScopeCommit); err != nil {
		t.Fatal(err)
	}
	if err := RequireScopes(auth.Scopes, ScopeAccountAdmin); err == nil {
		t.Fatal("expected account_admin denied")
	}
	if err := m.Revoke(clientID); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Authenticate(token); err == nil {
		t.Fatal("revoked token should fail")
	}
}

func TestPairExpire(t *testing.T) {
	dir := t.TempDir()
	store, err := config.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	m := NewManager(store, credentials.NewMemoryStore())
	p, _, err := m.StartPair("x", "readonly", nil)
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	m.pending[p.ID].ExpiresAt = time.Now().Add(-time.Second)
	m.mu.Unlock()
	if _, err := m.PairStatus(p.ID); err != ErrPairNotFound {
		t.Fatalf("got %v", err)
	}
}
