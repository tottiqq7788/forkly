package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"fyne.io/systray"
	"github.com/forkly-app/forkly/internal/agentauth"
	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/credentials"
	"github.com/forkly-app/forkly/internal/diagnostics"
	"github.com/forkly-app/forkly/internal/gitexec"
	gh "github.com/forkly-app/forkly/internal/github"
	"github.com/forkly-app/forkly/internal/localapi"
	"github.com/forkly-app/forkly/internal/localfile"
	"github.com/forkly-app/forkly/internal/operation"
	"github.com/forkly-app/forkly/internal/platform"
	"github.com/forkly-app/forkly/internal/project"
	"github.com/forkly-app/forkly/internal/runtimeinfo"
	"github.com/forkly-app/forkly/internal/session"
	"github.com/forkly-app/forkly/internal/watcher"
)

var Version = "0.1.50"

// LaunchPaths holds Markdown paths collected before the app is fully ready.
type LaunchOptions struct {
	OpenPaths []string
}

func Run(ctx context.Context, log *diagnostics.Logger, opts LaunchOptions) error {
	dataDir, err := config.DefaultDataDir()
	if err != nil {
		return err
	}
	runtimeDir := filepath.Join(dataDir, "runtime")
	_ = os.MkdirAll(runtimeDir, 0o700)

	si, browser, picker, reveal, openFiles, err := newPlatform(runtimeDir)
	if err != nil {
		return err
	}

	pending := filterMarkdownPaths(append([]string{}, opts.OpenPaths...))

	acquired, err := si.Acquire()
	if err != nil {
		return err
	}
	if !acquired {
		msg := platform.InstanceMessage{Op: platform.OpOpenConsole}
		if len(pending) > 0 {
			msg = platform.InstanceMessage{Op: platform.OpOpenFiles, Paths: pending}
		}
		if err := si.NotifyExisting(msg); err != nil {
			log.Error("notify existing instance", "err", err, "op", msg.Op, "count", len(msg.Paths))
		} else {
			log.Info("another instance running, forwarded message", "op", msg.Op, "count", len(msg.Paths))
		}
		return nil
	}
	defer si.Release()

	store, err := config.Open(dataDir)
	if err != nil {
		return err
	}

	rt, err := gitexec.DiscoverRuntime(gitexec.ResourcesDir())
	if err != nil {
		return fmt.Errorf("git runtime: %w", err)
	}
	log.Info("git runtime", "version", rt.Version, "bundled", rt.Bundled, "path", rt.GitPath)

	git := gitexec.NewExecutor(rt)
	projects := project.NewService(store, git)
	sessions := session.NewManager(12 * time.Hour)
	localFiles := localfile.NewService(git)
	creds := credentials.NewKeychainStore()
	agentCreds := credentials.NewKeychainStoreForService(credentials.AgentServiceName)
	githubClient := gh.NewClient(creds)
	ops := operation.NewManager()
	remotes := &project.RemoteService{
		Projects: projects,
		Store:    store,
		Git:      git,
		GitHub:   githubClient,
	}
	agents := agentauth.NewManager(store, agentCreds)
	bg := NewBackgroundFetcher(log, store, remotes)
	bg.SetProjects(projects)
	bg.Start()
	defer bg.Stop()
	defer ops.CancelAll()

	wm := watcher.New(func(projectID string) {
		log.Info("project changed", "id", projectID)
	})
	defer wm.Close()

	api := localapi.New(localapi.Deps{
		Log: log, Store: store, Git: git, Projects: projects,
		Remotes: remotes, GitHub: githubClient, Ops: ops,
		Sessions: sessions, Agents: agents, LocalFiles: localFiles,
		Picker: picker, Reveal: reveal, Watcher: wm, Version: Version,
	})
	addr, err := api.Start()
	if err != nil {
		return err
	}
	log.Info("local api listening", "addr", addr)
	runtimeInfo, rtErr := runtimeinfo.New(addr, Version)
	if rtErr != nil {
		log.Error("runtime info create", "err", rtErr)
	} else {
		api.SetRuntime(runtimeInfo)
		if err := runtimeinfo.Write(dataDir, runtimeInfo); err != nil {
			log.Error("runtime info write", "err", err)
		} else {
			defer func() {
				if err := runtimeinfo.RemoveIfOwner(dataDir, runtimeInfo); err != nil {
					log.Error("runtime info remove", "err", err)
				}
			}()
		}
	}
	defer api.Shutdown(context.Background())

	openConsole := func() {
		url := api.OpenConsoleURL()
		if err := browser.OpenURL(url); err != nil {
			log.Error("open browser", "err", err)
		}
	}

	openLocalFiles := func(paths []string) {
		deps := openTargetDeps{
			git:        git,
			projects:   projects,
			localFiles: localFiles,
			log:        log,
		}
		for _, p := range dedupeRecentMarkdownPaths(filterMarkdownPaths(paths)) {
			target, err := resolveOpenDocumentTarget(context.Background(), deps, p)
			if err != nil {
				log.Error("open local markdown", "path", p, "err", err)
				continue
			}
			if target.ProjectCreated && target.ProjectID != "" {
				if err := wm.Watch(target.ProjectID, target.ProjectPath); err != nil {
					log.Error("watch auto-registered project", "id", target.ProjectID, "err", err)
				}
			}
			openURL := api.OpenConsoleURLWithNext(target.Next)
			if err := browser.OpenURL(openURL); err != nil {
				log.Error("open browser for local file", "path", p, "err", err)
			}
		}
	}

	si.Listen(func(msg platform.InstanceMessage) {
		switch msg.Op {
		case platform.OpOpenFiles:
			log.Info("open documents event", "source", "ipc", "count", len(msg.Paths))
			if len(msg.Paths) == 0 {
				openConsole()
				return
			}
			openLocalFiles(msg.Paths)
		default:
			openConsole()
		}
	})

	// Register AppKit open-files hook before entering the systray event loop so
	// cold-start and hot-open Finder events are acknowledged successfully.
	if openFiles != nil {
		if err := openFiles.StartOpenFilesWatcher(func(paths []string) {
			log.Info("open documents event", "source", "appkit", "count", len(paths))
			openLocalFiles(paths)
		}); err != nil {
			log.Error("install open files delegate hook", "err", err)
		}
	}

	for _, p := range store.Snapshot().Projects {
		_ = wm.Watch(p.ID, p.Path)
	}

	if len(pending) > 0 {
		log.Info("open documents event", "source", "argv", "count", len(pending))
		openLocalFiles(pending)
	} else {
		// Keep previous behavior: do not auto-open console on every launch.
		// Users open via tray menu. Document launches open editors above.
	}

	go func() {
		<-ctx.Done()
		systray.Quit()
	}()

	systray.Run(func() {
		icon := trayIconBytes()
		if runtime.GOOS == "windows" {
			systray.SetIcon(trayWindowsIconBytes())
		} else {
			systray.SetTemplateIcon(icon, icon)
		}
		systray.SetTitle("")
		systray.SetTooltip("Forkly " + Version)
		mOpen := systray.AddMenuItem("打开控制台", "在浏览器中打开本地控制台")
		mPair := systray.AddMenuItem("有待确认的 CLI 授权…", "打开设置核对配对码")
		mPair.Hide()
		list, _ := projects.List(context.Background())
		statusLabel := formatTrayStatusLabel(list)
		mStatus := systray.AddMenuItem(statusLabel, "")
		mStatus.Disable()
		bg.SetTrayUpdater(func(label string) {
			mStatus.SetTitle(label)
		})
		systray.AddSeparator()
		mPause := systray.AddMenuItemCheckbox("暂停后台检查", "", !store.Snapshot().Preferences.BackgroundChecks)
		mLogs := systray.AddMenuItem("查看日志", "")
		mAbout := systray.AddMenuItem("关于 Forkly", "")
		systray.AddSeparator()
		mQuit := systray.AddMenuItem("退出", "")

		go func() {
			for {
				n := len(agents.Pending())
				if n > 0 {
					mPair.SetTitle(fmt.Sprintf("待确认 CLI 授权（%d）", n))
					mPair.Show()
				} else {
					mPair.Hide()
				}
				time.Sleep(2 * time.Second)
			}
		}()

		go func() {
			for {
				select {
				case <-mOpen.ClickedCh:
					openConsole()
				case <-mPair.ClickedCh:
					if err := browser.OpenURL(api.OpenConsoleURLWithNext("/settings")); err != nil {
						log.Error("open settings for agent pair", "err", err)
					}
				case <-mPause.ClickedCh:
					_ = store.Save(func(f *config.File) error {
						f.Preferences.BackgroundChecks = !mPause.Checked()
						return nil
					})
				case <-mLogs.ClickedCh:
					_ = reveal.Reveal(log.Dir())
				case <-mAbout.ClickedCh:
					openConsole()
				case <-mQuit.ClickedCh:
					systray.Quit()
					return
				}
			}
		}()
	}, nil)

	return nil
}

func filterMarkdownPaths(paths []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		abs, err := filepath.Abs(p)
		if err != nil {
			continue
		}
		if !gitexec.IsMarkdownPath(abs) {
			continue
		}
		if _, ok := seen[abs]; ok {
			continue
		}
		seen[abs] = struct{}{}
		out = append(out, abs)
	}
	return out
}

// Cold launch often delivers the same Markdown path via both argv and AppKit
// open-files within ~100ms. Opening twice races claim URLs in the browser.
var (
	recentOpenMu   sync.Mutex
	recentOpenPath = map[string]time.Time{}
)

func dedupeRecentMarkdownPaths(paths []string) []string {
	const window = 2 * time.Second
	now := time.Now()
	recentOpenMu.Lock()
	defer recentOpenMu.Unlock()
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		if t, ok := recentOpenPath[p]; ok && now.Sub(t) < window {
			continue
		}
		recentOpenPath[p] = now
		out = append(out, p)
	}
	for p, t := range recentOpenPath {
		if now.Sub(t) >= window {
			delete(recentOpenPath, p)
		}
	}
	return out
}
