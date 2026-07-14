package main

import "testing"

func TestGithubAskPassAllowed(t *testing.T) {
	ok := []string{
		"Password for 'https://github.com/octo/hello.git':",
		"Username for 'https://github.com':",
		"Password for 'https://github.com':",
		"(github.com)",
	}
	for _, p := range ok {
		if !githubAskPassAllowed(p) {
			t.Fatalf("expected allow: %q", p)
		}
	}
	deny := []string{
		"Password for 'https://evil.com':",
		"Username for 'https://notgithub.com':",
		"Password for 'https://github.com.evil.com':",
		"password please",
		"username?",
		"",
	}
	for _, p := range deny {
		if githubAskPassAllowed(p) {
			t.Fatalf("expected deny: %q", p)
		}
	}
}
