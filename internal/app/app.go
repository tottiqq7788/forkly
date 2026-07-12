package app

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"fyne.io/systray"
	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/diagnostics"
	"github.com/forkly-app/forkly/internal/gitexec"
	"github.com/forkly-app/forkly/internal/localapi"
	"github.com/forkly-app/forkly/internal/localfile"
	"github.com/forkly-app/forkly/internal/platform"
	"github.com/forkly-app/forkly/internal/project"
	"github.com/forkly-app/forkly/internal/session"
	"github.com/forkly-app/forkly/internal/watcher"
)

var Version = "0.1.32"

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

	pending := append([]string{}, opts.OpenPaths...)
	if openFiles != nil {
		pending = append(pending, openFiles.CollectLaunchOpenFiles()...)
	}
	pending = filterMarkdownPaths(pending)

	acquired, err := si.Acquire()
	if err != nil {
		return err
	}
	if !acquired {
		msg := platform.InstanceMessage{Op: platform.OpOpenConsole}
		if len(pending) > 0 {
			msg = platform.InstanceMessage{Op: platform.OpOpenFiles, Paths: pending}
		}
		_ = si.NotifyExisting(msg)
		log.Info("another instance running, forwarded message", "op", msg.Op, "paths", len(msg.Paths))
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

	wm := watcher.New(func(projectID string) {
		log.Info("project changed", "id", projectID)
	})
	defer wm.Close()

	api := localapi.New(localapi.Deps{
		Log: log, Store: store, Git: git, Projects: projects,
		Sessions: sessions, LocalFiles: localFiles,
		Picker: picker, Reveal: reveal, Watcher: wm, Version: Version,
	})
	addr, err := api.Start()
	if err != nil {
		return err
	}
	log.Info("local api listening", "addr", addr)
	defer api.Shutdown(context.Background())

	openConsole := func() {
		url := api.OpenConsoleURL()
		if err := browser.OpenURL(url); err != nil {
			log.Error("open browser", "err", err)
		}
	}

	openLocalFiles := func(paths []string) {
		for _, p := range filterMarkdownPaths(paths) {
			meta, err := localFiles.Open(p)
			if err != nil {
				log.Error("open local markdown", "path", p, "err", err)
				continue
			}
			next := "/editor/local/" + url.PathEscape(meta.FileID)
			openURL := api.OpenConsoleURLWithNext(next)
			if err := browser.OpenURL(openURL); err != nil {
				log.Error("open browser for local file", "path", p, "err", err)
			}
		}
	}

	si.Listen(func(msg platform.InstanceMessage) {
		switch msg.Op {
		case platform.OpOpenFiles:
			if len(msg.Paths) == 0 {
				openConsole()
				return
			}
			openLocalFiles(msg.Paths)
		default:
			openConsole()
		}
	})

	if openFiles != nil {
		openFiles.StartOpenFilesWatcher(func(paths []string) {
			openLocalFiles(paths)
		})
	}

	for _, p := range store.Snapshot().Projects {
		_ = wm.Watch(p.ID, p.Path)
	}

	if len(pending) > 0 {
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
		systray.SetTemplateIcon(icon, icon)
		systray.SetTitle("")
		systray.SetTooltip("Forkly " + Version)
		mOpen := systray.AddMenuItem("打开控制台", "在浏览器中打开本地控制台")
		list, _ := projects.List(context.Background())
		statusLabel := "暂无项目"
		if n := len(list); n > 0 {
			changes := 0
			for _, p := range list {
				changes += p.ChangeCount
			}
			statusLabel = fmt.Sprintf("%d 个项目，%d 个文件待保存", n, changes)
		}
		mStatus := systray.AddMenuItem(statusLabel, "")
		mStatus.Disable()
		systray.AddSeparator()
		mPause := systray.AddMenuItemCheckbox("暂停后台检查", "", !store.Snapshot().Preferences.BackgroundChecks)
		mLogs := systray.AddMenuItem("查看日志", "")
		mAbout := systray.AddMenuItem("关于 Forkly", "")
		systray.AddSeparator()
		mQuit := systray.AddMenuItem("退出", "")

		go func() {
			for {
				select {
				case <-mOpen.ClickedCh:
					openConsole()
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
