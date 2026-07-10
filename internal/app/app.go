package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"fyne.io/systray"
	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/diagnostics"
	"github.com/forkly-app/forkly/internal/gitexec"
	"github.com/forkly-app/forkly/internal/localapi"
	"github.com/forkly-app/forkly/internal/project"
	"github.com/forkly-app/forkly/internal/session"
	"github.com/forkly-app/forkly/internal/watcher"
)

var Version = "0.1.1"

func Run(ctx context.Context, log *diagnostics.Logger) error {
	dataDir, err := config.DefaultDataDir()
	if err != nil {
		return err
	}
	runtimeDir := filepath.Join(dataDir, "runtime")
	_ = os.MkdirAll(runtimeDir, 0o700)

	si, browser, picker, reveal, err := newPlatform(runtimeDir)
	if err != nil {
		return err
	}

	acquired, err := si.Acquire()
	if err != nil {
		return err
	}
	if !acquired {
		_ = si.NotifyExisting("open-console")
		log.Info("another instance running, forwarded open-console")
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

	wm := watcher.New(func(projectID string) {
		log.Info("project changed", "id", projectID)
	})
	defer wm.Close()

	api := localapi.New(localapi.Deps{
		Log: log, Store: store, Git: git, Projects: projects,
		Sessions: sessions, Picker: picker, Reveal: reveal, Version: Version,
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
	si.Listen(func(msg string) {
		if msg == "open-console" {
			openConsole()
		}
	})

	for _, p := range store.Snapshot().Projects {
		_ = wm.Watch(p.ID, p.Path)
	}

	onExit := make(chan struct{})
	go func() {
		<-ctx.Done()
		systray.Quit()
	}()

	systray.Run(func() {
		systray.SetTitle("Forkly")
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
	}, func() {
		close(onExit)
	})

	<-onExit
	return nil
}
