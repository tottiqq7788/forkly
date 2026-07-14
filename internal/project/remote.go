package project

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/gitexec"
	gh "github.com/forkly-app/forkly/internal/github"
)

type RemoteService struct {
	Projects *Service
	Store    *config.Store
	Git      *gitexec.Executor
	GitHub   *gh.Client
}

type RemoteStatusView struct {
	gitexec.SyncStatus
	Connected      bool             `json:"connected"`
	Provider       string           `json:"provider,omitempty"`
	AccountID      string           `json:"accountId,omitempty"`
	AccountLogin   string           `json:"accountLogin,omitempty"`
	AuthConfigured bool             `json:"authConfigured"`
	OAuthAvailable bool             `json:"oauthAvailable"`
	LinkedAt       *time.Time       `json:"linkedAt,omitempty"`
	LastFetchAt    *time.Time       `json:"lastFetchAt,omitempty"`
	DetectedOrigin *DetectedRemote  `json:"detectedOrigin,omitempty"`
	ActiveOp       any              `json:"activeOp,omitempty"`
	// Set after create-repo when the GitHub side succeeded but a later step failed.
	CreatedHTMLURL string `json:"createdHtmlUrl,omitempty"`
	PushError      string `json:"pushError,omitempty"`
}

type DetectedRemote struct {
	Name     string `json:"name"`
	FetchURL string `json:"fetchUrl"`
	Owner    string `json:"owner,omitempty"`
	Repo     string `json:"repo,omitempty"`
	IsGitHub bool   `json:"isGithub"`
	Message  string `json:"message,omitempty"`
}

type LinkRemoteRequest struct {
	URL          string `json:"url"`
	RemoteName   string `json:"remoteName"`
	Replace      bool   `json:"replace"`
	UseExisting  bool   `json:"useExisting"`
}

type UnlinkRemoteRequest struct {
	DeleteGitRemote bool `json:"deleteGitRemote"`
}

func (rs *RemoteService) Status(ctx context.Context, projectID string) (RemoteStatusView, error) {
	p, err := rs.Projects.Get(projectID)
	if err != nil {
		return RemoteStatusView{}, err
	}
	remoteName := "origin"
	accountID := ""
	var linkedAt *time.Time
	var lastFetch *time.Time
	if p.Remote != nil {
		if p.Remote.RemoteName != "" {
			remoteName = p.Remote.RemoteName
		}
		accountID = p.Remote.AccountID
		if !p.Remote.LinkedAt.IsZero() {
			t := p.Remote.LinkedAt
			linkedAt = &t
		}
		lastFetch = p.Remote.LastFetchAt
	}
	sync, err := rs.Git.RemoteSyncStatus(ctx, p.Path, remoteName)
	if err != nil {
		return RemoteStatusView{}, err
	}
	out := RemoteStatusView{
		SyncStatus:     sync,
		Connected:      p.Remote != nil,
		OAuthAvailable: rs.GitHub != nil && rs.GitHub.OAuthConfigured(),
		LinkedAt:       linkedAt,
		LastFetchAt:    lastFetch,
	}
	if p.Remote != nil {
		out.Provider = p.Remote.Provider
		out.AccountID = p.Remote.AccountID
		if p.Remote.Owner != "" {
			out.Owner = p.Remote.Owner
		}
		if p.Remote.Repo != "" {
			out.Repo = p.Remote.Repo
		}
	}
	snap := rs.Store.Snapshot()
	if snap.GitHubAccount != nil {
		out.AccountLogin = snap.GitHubAccount.Login
		if accountID == "" {
			accountID = snap.GitHubAccount.AccountID
		}
		out.AuthConfigured = true
	} else if accountID != "" {
		if _, err := rs.GitHub.GetToken(accountID); err == nil {
			out.AuthConfigured = true
		}
	}
	out.DetectedOrigin = detectOrigin(sync.Remotes)
	return out, nil
}

func detectOrigin(remotes []gitexec.RemoteInfo) *DetectedRemote {
	for _, r := range remotes {
		if r.Name != "origin" && len(remotes) > 1 {
			continue
		}
		d := &DetectedRemote{Name: r.Name, FetchURL: r.FetchURL}
		if ref, err := gitexec.ParseGitHubHTTPSURL(r.FetchURL); err == nil {
			d.IsGitHub = true
			d.Owner = ref.Owner
			d.Repo = ref.Repo
		} else if strings.HasPrefix(strings.ToLower(r.FetchURL), "git@") {
			d.Message = "检测到 SSH 远端，请改为 HTTPS 后再用 Forkly 连接"
		} else {
			d.Message = "检测到非 GitHub HTTPS 远端，本版不会注入凭据"
		}
		if r.Name == "origin" {
			return d
		}
		if len(remotes) == 1 {
			return d
		}
	}
	return nil
}

func (rs *RemoteService) Link(ctx context.Context, projectID string, req LinkRemoteRequest) (RemoteStatusView, error) {
	p, err := rs.Projects.Get(projectID)
	if err != nil {
		return RemoteStatusView{}, err
	}
	snap := rs.Store.Snapshot()
	if snap.GitHubAccount == nil {
		return RemoteStatusView{}, &gh.APIError{Code: gh.CodeAuthRequired, Message: "请先在设置中连接 GitHub 账号"}
	}
	accountID := snap.GitHubAccount.AccountID
	remoteName := strings.TrimSpace(req.RemoteName)
	if remoteName == "" {
		remoteName = "origin"
	}

	var ref gitexec.GitHubRepoRef
	if req.UseExisting {
		remotes, err := rs.Git.ListRemotes(ctx, p.Path)
		if err != nil {
			return RemoteStatusView{}, err
		}
		found := false
		for _, r := range remotes {
			if r.Name == remoteName {
				ref, err = gitexec.ParseGitHubHTTPSURL(r.FetchURL)
				if err != nil {
					return RemoteStatusView{}, err
				}
				found = true
				break
			}
		}
		if !found {
			return RemoteStatusView{}, fmt.Errorf("本地没有可复用的远端「%s」", remoteName)
		}
	} else {
		ref, err = gitexec.ParseGitHubHTTPSURL(req.URL)
		if err != nil {
			return RemoteStatusView{}, err
		}
		remotes, _ := rs.Git.ListRemotes(ctx, p.Path)
		needAdd := true
		for _, r := range remotes {
			if r.Name != remoteName {
				continue
			}
			existing, perr := gitexec.ParseGitHubHTTPSURL(r.FetchURL)
			if perr == nil && existing.Owner == ref.Owner && existing.Repo == ref.Repo {
				needAdd = false
				break
			}
			if !req.Replace {
				return RemoteStatusView{}, &ConflictError{
					Message:     fmt.Sprintf("远端「%s」已指向其他仓库，如需更换请确认替换", remoteName),
					ExistingURL: r.FetchURL,
				}
			}
			if err := rs.Git.SetRemoteURL(ctx, p.Path, remoteName, ref.URL); err != nil {
				return RemoteStatusView{}, err
			}
			needAdd = false
			break
		}
		if needAdd {
			if err := rs.Git.AddRemote(ctx, p.Path, remoteName, ref.URL); err != nil {
				return RemoteStatusView{}, err
			}
		}
	}

	// Verify API access when possible.
	if _, err := rs.GitHub.GetRepo(ctx, accountID, ref.Owner, ref.Repo); err != nil {
		var apiErr *gh.APIError
		if gh.AsAPIError(err, &apiErr) && (apiErr.Code == gh.CodeAuthRequired || apiErr.Code == gh.CodeInvalidToken || apiErr.Code == gh.CodeTokenExpired) {
			return RemoteStatusView{}, err
		}
	}

	now := time.Now()
	err = rs.Store.Save(func(f *config.File) error {
		for i := range f.Projects {
			if f.Projects[i].ID == projectID {
				f.Projects[i].Remote = &config.RemoteLink{
					Provider:   "github",
					RemoteName: remoteName,
					Owner:      ref.Owner,
					Repo:       ref.Repo,
					AccountID:  accountID,
					LinkedAt:   now,
				}
				return nil
			}
		}
		return fmt.Errorf("项目不存在")
	})
	if err != nil {
		return RemoteStatusView{}, err
	}
	return rs.Status(ctx, projectID)
}

type ConflictError struct {
	Message     string
	ExistingURL string
}

func (e *ConflictError) Error() string { return e.Message }

func (rs *RemoteService) Unlink(projectID string, deleteGitRemote bool) error {
	p, err := rs.Projects.Get(projectID)
	if err != nil {
		return err
	}
	remoteName := "origin"
	if p.Remote != nil && p.Remote.RemoteName != "" {
		remoteName = p.Remote.RemoteName
	}
	if deleteGitRemote {
		_ = rs.Git.RemoveRemote(context.Background(), p.Path, remoteName)
	}
	return rs.Store.Save(func(f *config.File) error {
		for i := range f.Projects {
			if f.Projects[i].ID == projectID {
				f.Projects[i].Remote = nil
				return nil
			}
		}
		return fmt.Errorf("项目不存在")
	})
}

func (rs *RemoteService) authEnv(accountID string) (gitexec.AuthEnv, error) {
	ask := AskPassPath()
	if ask == "" {
		return gitexec.AuthEnv{}, fmt.Errorf("未找到 forkly-askpass，请重新安装 Forkly（或先执行 make build）")
	}
	if accountID == "" {
		snap := rs.Store.Snapshot()
		if snap.GitHubAccount == nil {
			return gitexec.AuthEnv{}, &gh.APIError{Code: gh.CodeAuthRequired, Message: "请先连接 GitHub 账号"}
		}
		accountID = snap.GitHubAccount.AccountID
	}
	secret, err := rs.GitHub.GetToken(accountID)
	if err != nil {
		return gitexec.AuthEnv{}, err
	}
	return gitexec.AuthEnv{
		AskPassPath: ask,
		AccountID:   accountID,
		Token:       secret.Token,
		Login:       secret.Login,
	}, nil
}

func (rs *RemoteService) markFetched(projectID string) {
	now := time.Now()
	_ = rs.Store.Save(func(f *config.File) error {
		for i := range f.Projects {
			if f.Projects[i].ID == projectID && f.Projects[i].Remote != nil {
				t := now
				f.Projects[i].Remote.LastFetchAt = &t
				return nil
			}
		}
		return nil
	})
}

func (rs *RemoteService) Fetch(ctx context.Context, projectID string) error {
	p, err := rs.Projects.Get(projectID)
	if err != nil {
		return err
	}
	if p.Remote == nil {
		return fmt.Errorf("项目尚未关联 GitHub 仓库")
	}
	auth, err := rs.authEnv(p.Remote.AccountID)
	if err != nil {
		return err
	}
	if err := rs.Git.Fetch(ctx, p.Path, p.Remote.RemoteName, auth); err != nil {
		return err
	}
	rs.markFetched(projectID)
	return nil
}

func (rs *RemoteService) Pull(ctx context.Context, projectID string) error {
	p, err := rs.Projects.Get(projectID)
	if err != nil {
		return err
	}
	if p.Remote == nil {
		return fmt.Errorf("项目尚未关联 GitHub 仓库")
	}
	auth, err := rs.authEnv(p.Remote.AccountID)
	if err != nil {
		return err
	}
	branch := ""
	if err := rs.Git.PullFFOnly(ctx, p.Path, p.Remote.RemoteName, branch, auth); err != nil {
		return err
	}
	rs.markFetched(projectID)
	return nil
}

func (rs *RemoteService) Push(ctx context.Context, projectID string) error {
	p, err := rs.Projects.Get(projectID)
	if err != nil {
		return err
	}
	if p.Remote == nil {
		return fmt.Errorf("项目尚未关联 GitHub 仓库")
	}
	auth, err := rs.authEnv(p.Remote.AccountID)
	if err != nil {
		return err
	}
	st, err := rs.Git.Status(ctx, p.Path)
	if err != nil {
		return err
	}
	upstream, _ := rs.Git.RemoteSyncStatus(ctx, p.Path, p.Remote.RemoteName)
	setUpstream := !upstream.HasUpstream
	return rs.Git.Push(ctx, p.Path, p.Remote.RemoteName, st.Health.Branch, setUpstream, auth)
}

func (rs *RemoteService) CloneAndRegister(ctx context.Context, rawURL, parentDir, folderName string) (ProjectView, error) {
	snap := rs.Store.Snapshot()
	if snap.GitHubAccount == nil {
		return ProjectView{}, &gh.APIError{Code: gh.CodeAuthRequired, Message: "请先连接 GitHub 账号"}
	}
	ref, err := gitexec.ParseGitHubHTTPSURL(rawURL)
	if err != nil {
		return ProjectView{}, err
	}
	if folderName == "" {
		folderName = ref.Repo
	}
	dest := filepath.Join(parentDir, folderName)
	auth, err := rs.authEnv(snap.GitHubAccount.AccountID)
	if err != nil {
		return ProjectView{}, err
	}
	if err := rs.Git.Clone(ctx, ref.URL, dest, auth); err != nil {
		return ProjectView{}, err
	}
	res, err := rs.Projects.EnsureRegistered(ctx, dest)
	if err != nil {
		return ProjectView{}, err
	}
	now := time.Now()
	_ = rs.Store.Save(func(f *config.File) error {
		for i := range f.Projects {
			if f.Projects[i].ID == res.Project.ID {
				f.Projects[i].Remote = &config.RemoteLink{
					Provider:   "github",
					RemoteName: "origin",
					Owner:      ref.Owner,
					Repo:       ref.Repo,
					AccountID:  snap.GitHubAccount.AccountID,
					LinkedAt:   now,
				}
				return nil
			}
		}
		return nil
	})
	return ProjectView{
		ID: res.Project.ID, Name: res.Project.Name, Path: res.Project.Path,
		AddedAt: res.Project.AddedAt, OpenedAt: res.Project.OpenedAt, Exists: true, Summary: "无修改",
	}, nil
}

func (rs *RemoteService) CreateGitHubRepo(ctx context.Context, projectID, name, description string, private bool) (RemoteStatusView, error) {
	p, err := rs.Projects.Get(projectID)
	if err != nil {
		return RemoteStatusView{}, err
	}
	snap := rs.Store.Snapshot()
	if snap.GitHubAccount == nil {
		return RemoteStatusView{}, &gh.APIError{Code: gh.CodeAuthRequired, Message: "请先连接 GitHub 账号"}
	}
	if name == "" {
		name = p.Name
	}
	info, err := rs.GitHub.CreateRepo(ctx, snap.GitHubAccount.AccountID, name, description, private)
	if err != nil {
		return RemoteStatusView{}, err
	}
	st, err := rs.Link(ctx, projectID, LinkRemoteRequest{
		URL:        info.CloneURL,
		RemoteName: "origin",
		Replace:    true,
	})
	if err != nil {
		// Do not delete the remote repo; surface URL for recovery.
		return RemoteStatusView{
			CreatedHTMLURL: info.HTMLURL,
			AuthConfigured: true,
			PushError:      "仓库已在 GitHub 创建，但本地关联失败：" + err.Error(),
		}, nil
	}
	st.CreatedHTMLURL = info.HTMLURL
	if pushErr := rs.Push(ctx, projectID); pushErr != nil {
		st.PushError = pushErr.Error()
		st.PushHints = append([]string{"仓库已创建并关联；首次推送失败，可稍后手动推送。"}, st.PushHints...)
	}
	return st, nil
}

