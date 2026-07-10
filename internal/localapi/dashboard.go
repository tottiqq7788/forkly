package localapi

import (
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/forkly-app/forkly/internal/gitexec"
)

type dashboardDay struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type dashboardActivityResponse struct {
	Days            int            `json:"days"`
	TotalCommits    int            `json:"totalCommits"`
	RecentCommits   int            `json:"recentCommits"`
	Series          []dashboardDay `json:"series"`
	ScannedProjects int            `json:"scannedProjects"`
	Unavailable     int            `json:"unavailable"`
}

func (s *Server) handleDashboardActivity(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	days := 30
	if raw := r.URL.Query().Get("days"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 90 {
			writeErr(w, http.StatusBadRequest, "days 须为 1–90")
			return
		}
		days = n
	}

	snap := s.deps.Store.Snapshot()
	type item struct {
		path string
	}
	var targets []item
	unavailable := 0
	for _, p := range snap.Projects {
		st, err := os.Stat(p.Path)
		if err != nil || !st.IsDir() {
			unavailable++
			continue
		}
		targets = append(targets, item{path: p.Path})
	}

	seriesKeys := gitexec.DaySeries(days, time.Now())
	byDay := make(map[string]int, len(seriesKeys))
	for _, k := range seriesKeys {
		byDay[k] = 0
	}

	var (
		mu            sync.Mutex
		totalCommits  int
		recentCommits int
		wg            sync.WaitGroup
		sem           = make(chan struct{}, 4)
	)

	for _, t := range targets {
		wg.Add(1)
		go func(repo string) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-r.Context().Done():
				mu.Lock()
				unavailable++
				mu.Unlock()
				return
			}
			act, err := s.deps.Git.RecentCommitActivity(r.Context(), repo, days)
			mu.Lock()
			defer mu.Unlock()
			if err != nil || r.Context().Err() != nil {
				unavailable++
				return
			}
			totalCommits += act.TotalCommits
			recentCommits += act.RecentCommits
			for day, n := range act.ByDay {
				if _, ok := byDay[day]; ok {
					byDay[day] += n
				}
			}
		}(t.path)
	}
	wg.Wait()

	if err := r.Context().Err(); err != nil {
		writeErr(w, http.StatusRequestTimeout, err.Error())
		return
	}

	series := make([]dashboardDay, 0, len(seriesKeys))
	for _, k := range seriesKeys {
		series = append(series, dashboardDay{Date: k, Count: byDay[k]})
	}

	writeJSON(w, http.StatusOK, dashboardActivityResponse{
		Days:            days,
		TotalCommits:    totalCommits,
		RecentCommits:   recentCommits,
		Series:          series,
		ScannedProjects: len(targets),
		Unavailable:     unavailable,
	})
}
