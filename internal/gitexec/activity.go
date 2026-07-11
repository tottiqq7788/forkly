package gitexec

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Cap daily-series log lines so a pathological repo cannot OOM the dashboard.
const activityLogMaxCount = 10000

// RepoActivity is commit activity for a single repository.
type RepoActivity struct {
	TotalCommits  int            `json:"totalCommits"`
	RecentCommits int            `json:"recentCommits"`
	ByDay         map[string]int `json:"byDay"` // YYYY-MM-DD in local time
}

// CountCommits returns the number of commits reachable from HEAD.
// Empty repositories (no HEAD) return 0 without error.
func (e *Executor) CountCommits(ctx context.Context, repo string) (int, error) {
	health, err := e.Health(ctx, repo)
	if err != nil {
		return 0, err
	}
	if !health.HasHead {
		return 0, nil
	}
	return e.revListCount(ctx, repo, nil)
}

func (e *Executor) revListCount(ctx context.Context, repo string, extraArgs []string) (int, error) {
	args := []string{"rev-list", "--count"}
	args = append(args, extraArgs...)
	args = append(args, "HEAD")
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    args,
		Timeout: 30 * time.Second,
	})
	if err != nil {
		return 0, err
	}
	n, err := strconv.Atoi(strings.TrimSpace(string(res.Stdout)))
	if err != nil {
		return 0, fmt.Errorf("parse commit count: %w", err)
	}
	return n, nil
}

// RecentCommitActivity returns commits since the start of (today - days + 1)
// in the local timezone, grouped by local calendar day.
func (e *Executor) RecentCommitActivity(ctx context.Context, repo string, days int) (RepoActivity, error) {
	if days <= 0 {
		days = 30
	}
	out := RepoActivity{ByDay: map[string]int{}}

	health, err := e.Health(ctx, repo)
	if err != nil {
		return out, err
	}
	if !health.HasHead {
		return out, nil
	}

	total, err := e.revListCount(ctx, repo, nil)
	if err != nil {
		return out, err
	}
	out.TotalCommits = total
	if total == 0 {
		return out, nil
	}

	now := time.Now()
	loc := now.Location()
	startDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, -(days - 1))
	since := startDay.Format(time.RFC3339)

	recent, err := e.revListCount(ctx, repo, []string{"--since=" + since})
	if err != nil {
		return out, err
	}
	out.RecentCommits = recent
	if recent == 0 {
		return out, nil
	}

	res, err := e.Run(ctx, RunOpts{
		Repo: repo,
		Args: []string{
			"log",
			"--since=" + since,
			"--format=%aI",
			fmt.Sprintf("--max-count=%d", activityLogMaxCount),
			"HEAD",
		},
		Timeout: 45 * time.Second,
	})
	if err != nil {
		return out, err
	}
	lines := strings.Split(strings.TrimSpace(string(res.Stdout)), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		t, err := time.Parse(time.RFC3339, line)
		if err != nil {
			// Some git builds emit timezone without colon; try fallback.
			t, err = time.Parse("2006-01-02T15:04:05-0700", line)
			if err != nil {
				continue
			}
		}
		local := t.In(loc)
		day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
		if day.Before(startDay) {
			continue
		}
		key := day.Format("2006-01-02")
		out.ByDay[key]++
	}
	return out, nil
}

// DaySeries returns a contiguous list of local dates from startDay for `days` days.
func DaySeries(days int, now time.Time) []string {
	if days <= 0 {
		days = 30
	}
	loc := now.Location()
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, -(days - 1))
	out := make([]string, 0, days)
	for i := 0; i < days; i++ {
		out = append(out, start.AddDate(0, 0, i).Format("2006-01-02"))
	}
	return out
}
