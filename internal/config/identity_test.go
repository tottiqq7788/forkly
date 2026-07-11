package config

import "testing"

func TestIdentityConfigured(t *testing.T) {
	if IdentityConfigured(GitIdentity{}) {
		t.Fatal("empty should be false")
	}
	if IdentityConfigured(GitIdentity{Name: DefaultIdentityName, Email: DefaultIdentityEmail}) {
		t.Fatal("default placeholder should be false")
	}
	if IdentityConfigured(GitIdentity{Name: "Alice", Email: ""}) {
		t.Fatal("missing email should be false")
	}
	if !IdentityConfigured(GitIdentity{Name: "Alice", Email: "a@example.com"}) {
		t.Fatal("real identity should be true")
	}
	if !IdentityConfigured(GitIdentity{Name: DefaultIdentityName, Email: "a@example.com"}) {
		t.Fatal("custom email with default name should count as configured")
	}
}
