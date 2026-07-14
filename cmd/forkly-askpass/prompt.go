package main

import (
	"strings"
	"unicode"
)

// githubAskPassAllowed reports whether a GIT_ASKPASS prompt is safe to answer
// with a GitHub token. The prompt must mention github.com as a hostname (not a
// substring of another domain), matching typical Git HTTPS credential prompts.
func githubAskPassAllowed(prompt string) bool {
	lower := strings.ToLower(prompt)
	const host = "github.com"
	for i := 0; i+len(host) <= len(lower); i++ {
		if lower[i:i+len(host)] != host {
			continue
		}
		if i > 0 {
			prev := rune(lower[i-1])
			if unicode.IsLetter(prev) || unicode.IsDigit(prev) || prev == '.' || prev == '-' {
				continue // e.g. notgithub.com, spoof.github.com.evil
			}
		}
		end := i + len(host)
		if end < len(lower) {
			next := rune(lower[end])
			if unicode.IsLetter(next) || unicode.IsDigit(next) || next == '.' || next == '-' {
				continue // e.g. github.com.evil.com
			}
		}
		return true
	}
	return false
}
