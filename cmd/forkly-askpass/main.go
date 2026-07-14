package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/forkly-app/forkly/internal/credentials"
)

// forkly-askpass is invoked by Git via GIT_ASKPASS.
// It only returns credentials for github.com prompts and a configured account.
// Prefer FORKLY_ASKPASS_TOKEN when the parent (Forkly) injects it for this
// single git invocation (needed for in-memory credential stores / tests);
// otherwise read the system keychain for FORKLY_ASKPASS_ACCOUNT.
func main() {
	prompt := strings.Join(os.Args[1:], " ")
	accountID := strings.TrimSpace(os.Getenv("FORKLY_ASKPASS_ACCOUNT"))
	if accountID == "" {
		fmt.Fprintln(os.Stderr, "forkly-askpass: missing account")
		os.Exit(1)
	}
	if !githubAskPassAllowed(prompt) {
		fmt.Fprintln(os.Stderr, "forkly-askpass: unexpected prompt")
		os.Exit(1)
	}

	secret, err := loadSecret(accountID)
	if err != nil {
		fmt.Fprintln(os.Stderr, "forkly-askpass: credential unavailable")
		os.Exit(1)
	}
	lower := strings.ToLower(prompt)
	if strings.Contains(lower, "username") {
		login := secret.Login
		if envLogin := strings.TrimSpace(os.Getenv("FORKLY_ASKPASS_LOGIN")); envLogin != "" {
			login = envLogin
		}
		if login == "" {
			login = "x-access-token"
		}
		// GitHub Apps / tokens: username can be x-access-token or the login.
		if secret.Kind == credentials.KindOAuth || strings.HasPrefix(secret.Token, "ghu_") || strings.HasPrefix(secret.Token, "ghs_") {
			login = "x-access-token"
		}
		fmt.Print(login)
		return
	}
	fmt.Print(secret.Token)
}

func loadSecret(accountID string) (credentials.Secret, error) {
	if tok := strings.TrimSpace(os.Getenv("FORKLY_ASKPASS_TOKEN")); tok != "" {
		return credentials.Secret{
			Kind:  credentials.KindPAT,
			Token: tok,
			Login: strings.TrimSpace(os.Getenv("FORKLY_ASKPASS_LOGIN")),
		}, nil
	}
	store := credentials.NewKeychainStore()
	return store.Get(accountID)
}
