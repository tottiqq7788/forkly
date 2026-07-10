package gitexec

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

type Runtime struct {
	GitPath    string
	ExecPath   string
	TemplateDir string
	Version    string
	Bundled    bool
}

type Result struct {
	Stdout   []byte
	Stderr   []byte
	ExitCode int
}

type Executor struct {
	rt      Runtime
	writeMu sync.Map // repo path -> *sync.Mutex
	sem     chan struct{}
}

func NewExecutor(rt Runtime) *Executor {
	return &Executor{
		rt:  rt,
		sem: make(chan struct{}, 4),
	}
}

func (e *Executor) Runtime() Runtime { return e.rt }

func DiscoverRuntime(appResources string) (Runtime, error) {
	candidates := []string{}
	if appResources != "" {
		candidates = append(candidates,
			filepath.Join(appResources, "git", "bin", "git"),
			filepath.Join(appResources, "git", "git"),
		)
	}
	// Dev fallback: repo-relative third_party
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(wd, "third_party", "git", "bin", "git"))
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			rt := Runtime{
				GitPath:  c,
				Bundled:  true,
				ExecPath: filepath.Join(filepath.Dir(filepath.Dir(c)), "libexec", "git-core"),
				TemplateDir: filepath.Join(filepath.Dir(filepath.Dir(c)), "share", "git-core", "templates"),
			}
			if ver, err := probeVersion(rt); err == nil {
				rt.Version = ver
			}
			return rt, nil
		}
	}
	// System git fallback for development.
	path, err := exec.LookPath("git")
	if err != nil {
		return Runtime{}, fmt.Errorf("no bundled or system git found")
	}
	rt := Runtime{GitPath: path, Bundled: false}
	if ver, err := probeVersion(rt); err == nil {
		rt.Version = ver
	}
	return rt, nil
}

func probeVersion(rt Runtime) (string, error) {
	cmd := exec.Command(rt.GitPath, "--version")
	applyEnv(cmd, rt)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func applyEnv(cmd *exec.Cmd, rt Runtime) {
	env := os.Environ()
	env = append(env,
		"GIT_TERMINAL_PROMPT=0",
		"GIT_OPTIONAL_LOCKS=0",
		"LC_ALL=C",
	)
	if rt.Bundled {
		binDir := filepath.Dir(rt.GitPath)
		env = append(env, "PATH="+binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
		if rt.ExecPath != "" {
			env = append(env, "GIT_EXEC_PATH="+rt.ExecPath)
		}
		if rt.TemplateDir != "" {
			env = append(env, "GIT_TEMPLATE_DIR="+rt.TemplateDir)
		}
	}
	cmd.Env = env
}

func (e *Executor) writeLock(repo string) *sync.Mutex {
	v, _ := e.writeMu.LoadOrStore(repo, &sync.Mutex{})
	return v.(*sync.Mutex)
}

type RunOpts struct {
	Repo      string
	Args      []string
	Timeout   time.Duration
	Write     bool
	Stdin     []byte
	ExtraEnv  []string
}

func (e *Executor) Run(ctx context.Context, opts RunOpts) (Result, error) {
	if opts.Timeout <= 0 {
		opts.Timeout = 60 * time.Second
	}
	if opts.Write && opts.Repo != "" {
		mu := e.writeLock(opts.Repo)
		mu.Lock()
		defer mu.Unlock()
	} else {
		select {
		case e.sem <- struct{}{}:
			defer func() { <-e.sem }()
		case <-ctx.Done():
			return Result{}, ctx.Err()
		}
	}

	cctx, cancel := context.WithTimeout(ctx, opts.Timeout)
	defer cancel()

	args := append([]string{
		"-c", "color.ui=false",
		"-c", "core.quotepath=false",
		"-c", "pager.status=false",
		"-c", "pager.diff=false",
		"-c", "pager.log=false",
	}, opts.Args...)

	cmd := exec.CommandContext(cctx, e.rt.GitPath, args...)
	applyEnv(cmd, e.rt)
	if len(opts.ExtraEnv) > 0 {
		cmd.Env = append(cmd.Env, opts.ExtraEnv...)
	}
	if opts.Repo != "" {
		cmd.Dir = opts.Repo
	}
	if opts.Stdin != nil {
		cmd.Stdin = bytes.NewReader(opts.Stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	res := Result{Stdout: stdout.Bytes(), Stderr: stderr.Bytes()}
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			res.ExitCode = ee.ExitCode()
			return res, fmt.Errorf("git %v: %w\n%s", opts.Args, err, strings.TrimSpace(stderr.String()))
		}
		if errors.Is(cctx.Err(), context.DeadlineExceeded) {
			return res, fmt.Errorf("git timed out: %v", opts.Args)
		}
		return res, err
	}
	return res, nil
}

func ResourcesDir() string {
	if runtime.GOOS != "darwin" {
		return ""
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	// .app/Contents/MacOS/forkly -> Resources
	return filepath.Clean(filepath.Join(filepath.Dir(exe), "..", "Resources"))
}
