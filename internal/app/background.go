package app

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/diagnostics"
	"github.com/forkly-app/forkly/internal/project"
)

// TrayStatusUpdater refreshes a tray status label after background work.
type TrayStatusUpdater func(label string)

// BackgroundFetcher periodically fetches remotes when BackgroundChecks is on.
type BackgroundFetcher struct {
	log       *diagnostics.Logger
	store     *config.Store
	remotes   *project.RemoteService
	projects  *project.Service
	onStatus  TrayStatusUpdater
	stop      chan struct{}
	wg        sync.WaitGroup
}

func NewBackgroundFetcher(log *diagnostics.Logger, store *config.Store, remotes *project.RemoteService) *BackgroundFetcher {
	return &BackgroundFetcher{log: log, store: store, remotes: remotes, stop: make(chan struct{})}
}

func (b *BackgroundFetcher) SetProjects(p *project.Service) { b.projects = p }

func (b *BackgroundFetcher) SetTrayUpdater(fn TrayStatusUpdater) { b.onStatus = fn }

func (b *BackgroundFetcher) Start() {
	b.wg.Add(1)
	go b.loop()
}

func (b *BackgroundFetcher) Stop() {
	close(b.stop)
	b.wg.Wait()
}

func (b *BackgroundFetcher) loop() {
	defer b.wg.Done()
	timer := time.NewTimer(20 * time.Second)
	defer timer.Stop()
	backoff := map[string]time.Duration{}
	for {
		select {
		case <-b.stop:
			return
		case <-timer.C:
			b.tick(backoff)
			timer.Reset(45*time.Second + time.Duration(rand.Intn(15))*time.Second)
		}
	}
}

func (b *BackgroundFetcher) tick(backoff map[string]time.Duration) {
	if b.remotes == nil {
		return
	}
	snap := b.store.Snapshot()
	if !snap.Preferences.BackgroundChecks {
		return
	}
	if snap.GitHubAccount == nil {
		return
	}
	sem := make(chan struct{}, 2)
	var wg sync.WaitGroup
	for _, p := range snap.Projects {
		if p.Remote == nil {
			continue
		}
		if d, ok := backoff[p.ID]; ok && d > 0 {
			backoff[p.ID] = d - 45*time.Second
			if backoff[p.ID] > 0 {
				continue
			}
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(projectID string) {
			defer wg.Done()
			defer func() { <-sem }()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			if err := b.remotes.Fetch(ctx, projectID); err != nil {
				b.log.Info("background fetch failed", "id", projectID, "err", err.Error())
				next := backoff[projectID]
				if next < time.Minute {
					next = time.Minute
				} else if next < 15*time.Minute {
					next *= 2
				}
				backoff[projectID] = next
				return
			}
			backoff[projectID] = 0
		}(p.ID)
	}
	wg.Wait()
	b.refreshTray()
}

func (b *BackgroundFetcher) refreshTray() {
	if b.onStatus == nil || b.projects == nil {
		return
	}
	list, err := b.projects.List(context.Background())
	if err != nil {
		return
	}
	b.onStatus(formatTrayStatusLabel(list))
}

func formatTrayStatusLabel(list []project.ProjectView) string {
	if n := len(list); n > 0 {
		changes := 0
		for _, p := range list {
			changes += p.ChangeCount
		}
		return fmt.Sprintf("%d 个项目，%d 个文件待保存%s", n, changes, formatTrayRemoteSummary(list))
	}
	return "暂无项目"
}

func formatTrayRemoteSummary(list []project.ProjectView) string {
	ahead := 0
	behind := 0
	for _, p := range list {
		ahead += p.Ahead
		behind += p.Behind
	}
	switch {
	case ahead > 0 && behind > 0:
		return fmt.Sprintf("，%d 待推送，%d 待拉取", ahead, behind)
	case ahead > 0:
		return fmt.Sprintf("，%d 待推送", ahead)
	case behind > 0:
		return fmt.Sprintf("，%d 待拉取", behind)
	default:
		return ""
	}
}
