package gitexec

import (
	"context"
	"fmt"
	"net/url"
	"path"
	"strings"
	"time"
)

type RemoteInfo struct {
	Name     string `json:"name"`
	FetchURL string `json:"fetchUrl"`
	PushURL  string `json:"pushUrl"`
}

type GitHubRepoRef struct {
	Owner string
	Repo  string
	URL   string // normalized https://github.com/owner/repo.git
}

type SyncStatus struct {
	Remotes       []RemoteInfo `json:"remotes"`
	RemoteName    string       `json:"remoteName,omitempty"`
	FetchURL      string       `json:"fetchUrl,omitempty"`
	Owner         string       `json:"owner,omitempty"`
	Repo          string       `json:"repo,omitempty"`
	Branch        string       `json:"branch,omitempty"`
	Upstream      string       `json:"upstream,omitempty"`
	DefaultBranch string       `json:"defaultBranch,omitempty"`
	Ahead         int          `json:"ahead"`
	Behind        int          `json:"behind"`
	Dirty         bool         `json:"dirty"`
	FileCount     int          `json:"fileCount"`
	HasUpstream   bool         `json:"hasUpstream"`
	CanFetch      bool         `json:"canFetch"`
	CanPull       bool         `json:"canPull"`
	CanPush       bool         `json:"canPush"`
	PullBlockers  []string     `json:"pullBlockers,omitempty"`
	PushHints     []string     `json:"pushHints,omitempty"`
	Diverged      bool         `json:"diverged"`
	Health        RepoHealth   `json:"health"`
}

// AuthEnv supplies non-interactive HTTPS auth for a single git invocation.
// When Token is set it is passed only via env to forkly-askpass (never argv/URL/config).
type AuthEnv struct {
	AskPassPath string
	AccountID   string
	Token       string // optional; preferred by askpass over keychain (dev / memory store)
	Login       string
	CredHelper  string // optional extra -c credential.helper
}

func (a AuthEnv) env() []string {
	if a.AskPassPath == "" {
		return nil
	}
	out := []string{
		"GIT_ASKPASS=" + a.AskPassPath,
		"SSH_ASKPASS=" + a.AskPassPath,
		"GIT_TERMINAL_PROMPT=0",
		"FORKLY_ASKPASS_ACCOUNT=" + a.AccountID,
		"DISPLAY=.", // some git builds require DISPLAY when using askpass
	}
	if a.Token != "" {
		out = append(out, "FORKLY_ASKPASS_TOKEN="+a.Token)
	}
	if a.Login != "" {
		out = append(out, "FORKLY_ASKPASS_LOGIN="+a.Login)
	}
	return out
}

// authGitArgs disables the user's credential helpers for one invocation so a
// token answered via AskPass is not persisted into ~/.git-credentials / OS stores.
func authGitArgs(args []string) []string {
	return append([]string{"-c", "credential.helper="}, args...)
}

// ParseGitHubHTTPSURL accepts https GitHub remotes only (no credentials in URL).
func ParseGitHubHTTPSURL(raw string) (GitHubRepoRef, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return GitHubRepoRef{}, remoteErr(ErrCodeInvalidURL, "请填写仓库地址")
	}
	lower := strings.ToLower(raw)
	if strings.HasPrefix(lower, "git@") || strings.Contains(lower, "ssh://") {
		return GitHubRepoRef{}, remoteErr(ErrCodeUnsupportedRemote, "暂不支持 SSH 地址，请使用 https://github.com/所有者/仓库.git")
	}
	if strings.HasPrefix(lower, "file:") || strings.HasPrefix(lower, "ext::") || strings.Contains(lower, ":///") {
		return GitHubRepoRef{}, remoteErr(ErrCodeInvalidURL, "不支持的仓库地址")
	}
	// Allow owner/repo shorthand.
	if !strings.Contains(raw, "://") && strings.Count(raw, "/") == 1 && !strings.Contains(raw, " ") {
		parts := strings.Split(raw, "/")
		owner, repo := parts[0], strings.TrimSuffix(parts[1], ".git")
		if owner == "" || repo == "" {
			return GitHubRepoRef{}, remoteErr(ErrCodeInvalidURL, "仓库地址无效")
		}
		return GitHubRepoRef{
			Owner: owner,
			Repo:  repo,
			URL:   fmt.Sprintf("https://github.com/%s/%s.git", owner, repo),
		}, nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return GitHubRepoRef{}, remoteErr(ErrCodeInvalidURL, "仓库地址无效")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return GitHubRepoRef{}, remoteErr(ErrCodeUnsupportedRemote, "仅支持 HTTPS 的 GitHub 地址")
	}
	if u.User != nil {
		return GitHubRepoRef{}, remoteErr(ErrCodeInvalidURL, "请勿在地址中包含用户名或令牌")
	}
	host := strings.ToLower(u.Hostname())
	if host != "github.com" && host != "www.github.com" {
		return GitHubRepoRef{}, remoteErr(ErrCodeUnsupportedRemote, "首版仅支持 github.com")
	}
	p := strings.Trim(u.Path, "/")
	p = strings.TrimSuffix(p, ".git")
	parts := strings.Split(p, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return GitHubRepoRef{}, remoteErr(ErrCodeInvalidURL, "仓库地址应类似 https://github.com/所有者/仓库")
	}
	owner, repo := parts[0], parts[1]
	return GitHubRepoRef{
		Owner: owner,
		Repo:  repo,
		URL:   fmt.Sprintf("https://github.com/%s/%s.git", owner, repo),
	}, nil
}

func IsGitHubHTTPSURL(raw string) bool {
	_, err := ParseGitHubHTTPSURL(raw)
	return err == nil
}

func (e *Executor) ListRemotes(ctx context.Context, repo string) ([]RemoteInfo, error) {
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"remote", "-v"},
		Timeout: 15 * time.Second,
	})
	if err != nil {
		return nil, err
	}
	return parseRemoteV(string(res.Stdout)), nil
}

func parseRemoteV(out string) []RemoteInfo {
	byName := map[string]*RemoteInfo{}
	order := []string{}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name, u := fields[0], fields[1]
		info, ok := byName[name]
		if !ok {
			info = &RemoteInfo{Name: name}
			byName[name] = info
			order = append(order, name)
		}
		kind := ""
		if len(fields) >= 3 {
			kind = strings.Trim(fields[2], "()")
		}
		switch kind {
		case "push":
			info.PushURL = u
		default:
			info.FetchURL = u
			if info.PushURL == "" {
				info.PushURL = u
			}
		}
	}
	outList := make([]RemoteInfo, 0, len(order))
	for _, n := range order {
		outList = append(outList, *byName[n])
	}
	return outList
}

func (e *Executor) AddRemote(ctx context.Context, repo, name, rawURL string) error {
	if err := assertRemoteName(name); err != nil {
		return err
	}
	ref, err := ParseGitHubHTTPSURL(rawURL)
	if err != nil {
		return err
	}
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"remote", "add", name, ref.URL},
		Write:   true,
		Timeout: 15 * time.Second,
	})
	if err != nil {
		msg := strings.TrimSpace(string(res.Stderr))
		if strings.Contains(msg, "already exists") {
			return remoteErr(ErrCodeRemoteConflict, fmt.Sprintf("远端「%s」已存在", name))
		}
		return err
	}
	return nil
}

func (e *Executor) SetRemoteURL(ctx context.Context, repo, name, rawURL string) error {
	if err := assertRemoteName(name); err != nil {
		return err
	}
	ref, err := ParseGitHubHTTPSURL(rawURL)
	if err != nil {
		return err
	}
	_, err = e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"remote", "set-url", name, ref.URL},
		Write:   true,
		Timeout: 15 * time.Second,
	})
	return err
}

func (e *Executor) RemoveRemote(ctx context.Context, repo, name string) error {
	if err := assertRemoteName(name); err != nil {
		return err
	}
	_, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"remote", "remove", name},
		Write:   true,
		Timeout: 15 * time.Second,
	})
	return err
}

func assertRemoteName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return remoteErr(ErrCodeInvalidURL, "远端名称不能为空")
	}
	if strings.HasPrefix(name, "-") || strings.ContainsAny(name, " \t\n/") {
		return remoteErr(ErrCodeInvalidURL, "远端名称无效")
	}
	return nil
}

// EnsureSafeGitHubRemote verifies the named remote still points at GitHub HTTPS
// without embedded credentials before injecting AskPass. Both fetch and push
// URLs are checked so a malicious pushurl cannot siphon the token.
func (e *Executor) EnsureSafeGitHubRemote(ctx context.Context, repo, name string) (GitHubRepoRef, error) {
	remotes, err := e.ListRemotes(ctx, repo)
	if err != nil {
		return GitHubRepoRef{}, err
	}
	for _, r := range remotes {
		if r.Name != name {
			continue
		}
		ref, err := ParseGitHubHTTPSURL(r.FetchURL)
		if err != nil {
			return GitHubRepoRef{}, err
		}
		pushURL := strings.TrimSpace(r.PushURL)
		if pushURL != "" && !urlsEquivalentGitHub(pushURL, ref) {
			pushRef, perr := ParseGitHubHTTPSURL(pushURL)
			if perr != nil {
				return GitHubRepoRef{}, remoteErr(ErrCodeUnsupportedRemote, "远端 pushurl 不是安全的 GitHub HTTPS 地址，已拒绝认证")
			}
			if pushRef.Owner != ref.Owner || pushRef.Repo != ref.Repo {
				return GitHubRepoRef{}, remoteErr(ErrCodeUnsupportedRemote, "远端 fetchurl 与 pushurl 指向不同仓库，已拒绝认证")
			}
		}
		return ref, nil
	}
	return GitHubRepoRef{}, remoteErr(ErrCodeRepositoryNotFound, fmt.Sprintf("找不到远端「%s」", name))
}

func urlsEquivalentGitHub(raw string, expect GitHubRepoRef) bool {
	ref, err := ParseGitHubHTTPSURL(raw)
	if err != nil {
		return false
	}
	return ref.Owner == expect.Owner && ref.Repo == expect.Repo
}

func (e *Executor) RemoteSyncStatus(ctx context.Context, repo, remoteName string) (SyncStatus, error) {
	st, err := e.Status(ctx, repo)
	if err != nil {
		return SyncStatus{}, err
	}
	remotes, err := e.ListRemotes(ctx, repo)
	if err != nil {
		return SyncStatus{}, err
	}
	out := SyncStatus{
		Remotes:   remotes,
		Dirty:     len(st.Files) > 0,
		FileCount: len(st.Files),
		Health:    st.Health,
		Branch:    st.Health.Branch,
	}
	if remoteName == "" {
		remoteName = "origin"
	}
	var selected *RemoteInfo
	for i := range remotes {
		if remotes[i].Name == remoteName {
			selected = &remotes[i]
			break
		}
	}
	if selected == nil && len(remotes) > 0 {
		selected = &remotes[0]
		remoteName = selected.Name
	}
	if selected == nil {
		return out, nil
	}
	out.RemoteName = remoteName
	out.FetchURL = selected.FetchURL
	if ref, err := ParseGitHubHTTPSURL(selected.FetchURL); err == nil {
		out.Owner = ref.Owner
		out.Repo = ref.Repo
		out.CanFetch = st.Health.OK || (!st.Health.Bare && !st.Health.IndexLocked)
	}

	upstream, _ := e.upstreamOfHEAD(ctx, repo)
	out.Upstream = upstream
	out.HasUpstream = upstream != ""
	if out.HasUpstream {
		ahead, behind, _ := e.aheadBehind(ctx, repo, upstream)
		out.Ahead = ahead
		out.Behind = behind
		out.Diverged = ahead > 0 && behind > 0
	}
	out.DefaultBranch = e.remoteHEADBranch(ctx, repo, remoteName)

	out.CanPush = out.CanFetch && !st.Health.Detached && st.Health.HasHead && !st.Health.MergeInProgress && !st.Health.RebaseInProgress
	if out.Dirty {
		out.PushHints = append(out.PushHints, "工作区有未保存修改，推送只会上传已保存的版本")
	}
	if !out.HasUpstream && out.CanPush {
		out.PushHints = append(out.PushHints, "首次推送将设置远端跟踪分支")
	}
	if out.Diverged {
		out.CanPull = false
		out.PullBlockers = append(out.PullBlockers, "本地与远端已分叉，无法仅用快进拉取")
	} else if out.Dirty {
		out.CanPull = false
		out.PullBlockers = append(out.PullBlockers, "工作区有未保存修改，请先保存版本后再拉取")
	} else if !out.HasUpstream && out.Behind == 0 {
		out.CanPull = out.CanFetch && out.Behind >= 0
		if out.DefaultBranch != "" && out.Branch != "" {
			out.CanPull = out.CanFetch
		}
	} else {
		out.CanPull = out.CanFetch && out.Behind > 0 && !out.Diverged
		if out.Behind == 0 && out.HasUpstream {
			out.CanPull = false
			out.PullBlockers = append(out.PullBlockers, "已是最新，无需拉取")
		}
	}
	if !canMutateBranches(st.Health) && out.Dirty {
		out.CanPull = false
	}
	if st.Health.Detached {
		out.CanPull = false
		out.CanPush = false
		out.PullBlockers = append(out.PullBlockers, "当前处于 detached HEAD")
	}
	return out, nil
}

func (e *Executor) upstreamOfHEAD(ctx context.Context, repo string) (string, error) {
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"},
		Timeout: 10 * time.Second,
	})
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(res.Stdout)), nil
}

func (e *Executor) aheadBehind(ctx context.Context, repo, upstream string) (ahead, behind int, err error) {
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"rev-list", "--left-right", "--count", "HEAD..." + upstream},
		Timeout: 30 * time.Second,
	})
	if err != nil {
		return 0, 0, err
	}
	fields := strings.Fields(strings.TrimSpace(string(res.Stdout)))
	if len(fields) != 2 {
		return 0, 0, fmt.Errorf("unexpected ahead/behind: %q", res.Stdout)
	}
	fmt.Sscanf(fields[0], "%d", &ahead)
	fmt.Sscanf(fields[1], "%d", &behind)
	return ahead, behind, nil
}

func (e *Executor) remoteHEADBranch(ctx context.Context, repo, remote string) string {
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"symbolic-ref", "--quiet", "--short", "refs/remotes/"+remote+"/HEAD"},
		Timeout: 10 * time.Second,
	})
	if err != nil {
		return ""
	}
	ref := strings.TrimSpace(string(res.Stdout))
	return strings.TrimPrefix(ref, remote+"/")
}

func (e *Executor) Fetch(ctx context.Context, repo, remote string, auth AuthEnv) error {
	if err := assertRemoteName(remote); err != nil {
		return err
	}
	if _, err := e.EnsureSafeGitHubRemote(ctx, repo, remote); err != nil {
		return err
	}
	res, err := e.Run(ctx, RunOpts{
		Repo:     repo,
		Args:     authGitArgs([]string{"fetch", "--prune", "--no-recurse-submodules", remote}),
		Write:    true,
		Timeout:  180 * time.Second,
		ExtraEnv: auth.env(),
	})
	if err != nil {
		return mapRemoteGitError(string(res.Stderr), err, isTimeout(err))
	}
	return nil
}

func (e *Executor) PullFFOnly(ctx context.Context, repo, remote, branch string, auth AuthEnv) error {
	st, err := e.ensureSwitchable(ctx, repo)
	if err != nil {
		if len(st.Files) > 0 {
			return remoteErr(ErrCodeDirtyWorktree, "工作区有未保存的修改，请先保存版本后再拉取")
		}
		return err
	}
	if err := assertRemoteName(remote); err != nil {
		return err
	}
	if _, err := e.EnsureSafeGitHubRemote(ctx, repo, remote); err != nil {
		return err
	}
	if err := e.Fetch(ctx, repo, remote, auth); err != nil {
		return err
	}
	upstream, _ := e.upstreamOfHEAD(ctx, repo)
	target := upstream
	if target == "" {
		if branch == "" {
			branch = st.Health.Branch
		}
		if branch == "" || branch == "detached HEAD" {
			return remoteErr(ErrCodeNoUpstream, "当前分支没有远端跟踪，无法拉取")
		}
		target = remote + "/" + branch
	}
	// Verify target exists after fetch.
	_, err = e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"rev-parse", "--verify", target},
		Timeout: 10 * time.Second,
	})
	if err != nil {
		return remoteErr(ErrCodeNoUpstream, "远端分支尚不存在，请先推送")
	}
	ahead, behind, _ := e.aheadBehind(ctx, repo, target)
	if ahead > 0 && behind > 0 {
		return remoteErr(ErrCodeDiverged, "本地与远端已分叉，无法仅用快进拉取")
	}
	if behind == 0 {
		return nil
	}
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"merge", "--ff-only", target},
		Write:   true,
		Timeout: 120 * time.Second,
	})
	if err != nil {
		return mapRemoteGitError(string(res.Stderr), err, isTimeout(err))
	}
	return nil
}

func (e *Executor) Push(ctx context.Context, repo, remote, branch string, setUpstream bool, auth AuthEnv) error {
	if err := assertRemoteName(remote); err != nil {
		return err
	}
	if _, err := e.EnsureSafeGitHubRemote(ctx, repo, remote); err != nil {
		return err
	}
	st, err := e.Status(ctx, repo)
	if err != nil {
		return err
	}
	if !canMutateBranches(st.Health) {
		if len(st.Health.Blockers) > 0 {
			return fmt.Errorf("%s", st.Health.Blockers[0])
		}
		return fmt.Errorf("当前仓库状态不允许推送")
	}
	if st.Health.Detached {
		return remoteErr(ErrCodeDirtyWorktree, "当前处于 detached HEAD，无法推送")
	}
	if branch == "" {
		branch = st.Health.Branch
	}
	if err := assertBranchName(branch); err != nil {
		return err
	}
	args := []string{"push"}
	if setUpstream {
		args = append(args, "-u")
	}
	args = append(args, remote, "refs/heads/"+branch+":refs/heads/"+branch)
	res, err := e.Run(ctx, RunOpts{
		Repo:     repo,
		Args:     authGitArgs(args),
		Write:    true,
		Timeout:  180 * time.Second,
		ExtraEnv: auth.env(),
	})
	if err != nil {
		return mapRemoteGitError(string(res.Stderr), err, isTimeout(err))
	}
	return nil
}

func isTimeout(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "timed out")
}

// DefaultRemoteName returns "origin" if present, else the first remote name.
func DefaultRemoteName(remotes []RemoteInfo) string {
	for _, r := range remotes {
		if r.Name == "origin" {
			return "origin"
		}
	}
	if len(remotes) > 0 {
		return remotes[0].Name
	}
	return "origin"
}

// RepoNameFromURL extracts the folder name suggestion from a GitHub URL.
func RepoNameFromURL(raw string) string {
	ref, err := ParseGitHubHTTPSURL(raw)
	if err != nil {
		return path.Base(strings.TrimSuffix(raw, ".git"))
	}
	return ref.Repo
}
