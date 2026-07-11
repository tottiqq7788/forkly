package config

import "testing"

func TestResolvedHideRules(t *testing.T) {
	unset := ProjectEntry{}
	got := unset.ResolvedHideRules()
	if len(got) != 1 || got[0] != DefaultHideRule {
		t.Fatalf("unset=%#v", got)
	}
	cleared := ProjectEntry{HideRules: []string{}}
	if len(cleared.ResolvedHideRules()) != 0 {
		t.Fatal("cleared should stay empty")
	}
	custom := ProjectEntry{HideRules: []string{"*.log", "tmp*"}}
	got = custom.ResolvedHideRules()
	if len(got) != 2 || got[0] != "*.log" {
		t.Fatalf("custom=%#v", got)
	}
}
