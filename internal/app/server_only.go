package app

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"time"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/diagnostics"
	"github.com/forkly-app/forkly/internal/gitexec"
	"github.com/forkly-app/forkly/internal/localapi"
	"github.com/forkly-app/forkly/internal/project"
	"github.com/forkly-app/forkly/internal/session"
	"github.com/forkly-app/forkly/internal/watcher"
)

type ServerOnlyOptions struct {
	DataDir string
	Listen  string
	DevMode bool
}

// RunServerOnly starts the local API without the menu bar (for tests / CI / Vite preview).
func RunServerOnly(ctx context.Context, log *diagnostics.Logger, dataDir string) (addr string, shutdown func(context.Context) error, openURL string, err error) {
	return RunServerOnlyWith(ctx, log, ServerOnlyOptions{DataDir: dataDir})
}

func RunServerOnlyWith(ctx context.Context, log *diagnostics.Logger, opts ServerOnlyOptions) (addr string, shutdown func(context.Context) error, openURL string, err error) {
	dataDir := opts.DataDir
	if dataDir == "" {
		dataDir, err = config.DefaultDataDir()
		if err != nil {
			return "", nil, "", err
		}
	}
	_ = os.MkdirAll(dataDir, 0o700)
	store, err := config.Open(dataDir)
	if err != nil {
		return "", nil, "", err
	}
	rt, err := gitexec.DiscoverRuntime(gitexec.ResourcesDir())
	if err != nil {
		return "", nil, "", err
	}
	git := gitexec.NewExecutor(rt)
	projects := project.NewService(store, git)
	sessions := session.NewManager(12 * time.Hour)
	wm := watcher.New(nil)
	for _, p := range store.Snapshot().Projects {
		_ = wm.Watch(p.ID, p.Path)
	}
	api := localapi.New(localapi.Deps{
		Log: log, Store: store, Git: git, Projects: projects,
		Sessions: sessions, Watcher: wm, Version: Version, DevMode: opts.DevMode,
	})
	addr, err = api.StartWith(localapi.StartOptions{Listen: opts.Listen})
	if err != nil {
		wm.Close()
		return "", nil, "", err
	}
	baseShutdown := api.Shutdown
	return addr, func(c context.Context) error {
		err := baseShutdown(c)
		wm.Close()
		return err
	}, api.OpenConsoleURL(), nil
}

// ClaimClient follows the one-time console URL and returns an HTTP client with session cookies.
func ClaimClient(openURL string) (*http.Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{
		Jar: jar,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	res, err := client.Get(openURL)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	u, _ := url.Parse(openURL)
	if u != nil {
		jar.SetCookies(u, res.Cookies())
	}
	return &http.Client{Jar: jar}, nil
}
