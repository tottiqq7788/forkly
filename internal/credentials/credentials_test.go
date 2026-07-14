package credentials

import (
	"errors"
	"testing"
)

func TestMemoryStoreRoundTrip(t *testing.T) {
	m := NewMemoryStore()
	secret := Secret{Kind: KindOAuth, Token: "ghu_test", Login: "octocat", Scopes: "repo"}
	if err := m.Set("acct1", secret); err != nil {
		t.Fatal(err)
	}
	got, err := m.Get("acct1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Token != "ghu_test" || got.Login != "octocat" || got.Kind != KindOAuth {
		t.Fatalf("unexpected %+v", got)
	}
	if err := m.Delete("acct1"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Get("acct1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want not found, got %v", err)
	}
}

func TestEncodeRejectsEmptyToken(t *testing.T) {
	if _, err := encodeSecret(Secret{Kind: KindPAT}); err == nil {
		t.Fatal("expected error")
	}
}
