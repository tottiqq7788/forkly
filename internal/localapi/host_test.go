package localapi

import (
	"testing"
)

func TestAllowedLocalHost(t *testing.T) {
	cases := []struct {
		host string
		ok   bool
	}{
		{"", true},
		{"127.0.0.1", true},
		{"127.0.0.1:8787", true},
		{"localhost", true},
		{"localhost:5173", true},
		{"LOCALHOST:8787", true},
		{"[::1]", true},
		{"[::1]:8787", true},
		{"127.0.0.1.evil", false},
		{"127.0.0.1.evil:80", false},
		{"evil.localhost", false},
		{"example.com", false},
		{"0.0.0.0", false},
		{"192.168.1.1:8787", false},
	}
	for _, tc := range cases {
		if got := allowedLocalHost(tc.host); got != tc.ok {
			t.Errorf("allowedLocalHost(%q)=%v, want %v", tc.host, got, tc.ok)
		}
	}
}

func TestAssertLoopbackListen(t *testing.T) {
	ok := []string{"127.0.0.1:0", "127.0.0.1:8787", "localhost:8787", "[::1]:0"}
	for _, addr := range ok {
		if err := assertLoopbackListen(addr); err != nil {
			t.Errorf("assertLoopbackListen(%q): %v", addr, err)
		}
	}
	bad := []string{"0.0.0.0:8787", "192.168.1.1:8787", ":8787", "example.com:8787"}
	for _, addr := range bad {
		if err := assertLoopbackListen(addr); err == nil {
			t.Errorf("assertLoopbackListen(%q) should fail", addr)
		}
	}
}
