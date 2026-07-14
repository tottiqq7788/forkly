package app

import (
	"testing"

	"github.com/forkly-app/forkly/internal/project"
)

func TestFormatTrayRemoteSummary(t *testing.T) {
	if got := formatTrayRemoteSummary(nil); got != "" {
		t.Fatalf("empty list: %q", got)
	}
	list := []project.ProjectView{
		{Ahead: 2, Behind: 0},
		{Ahead: 1, Behind: 3},
	}
	got := formatTrayRemoteSummary(list)
	want := "，3 待推送，3 待拉取"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	if got := formatTrayStatusLabel(nil); got != "暂无项目" {
		t.Fatalf("status empty: %q", got)
	}
}
