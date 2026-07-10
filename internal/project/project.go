package project

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/forkly-app/forkly/internal/config"
	"github.com/forkly-app/forkly/internal/gitexec"
	"github.com/forkly-app/forkly/internal/session"
)

type Service struct {
	store *config.Store
	git   *gitexec.Executor
}

func NewService(store *config.Store, git *gitexec.Executor) *Service {
	return &Service{store: store, git: git}
}

type ProjectView struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Path        string    `json:"path"`
	AddedAt     time.Time `json:"addedAt"`
	OpenedAt    time.Time `json:"openedAt"`
	Exists      bool      `json:"exists"`
	Branch      string    `json:"branch,omitempty"`
	ChangeCount int       `json:"changeCount"`
	Summary     string    `json:"summary"`
	Blockers    []string  `json:"blockers,omitempty"`
}

func (s *Service) List(ctx context.Context) ([]ProjectView, error) {
	snap := s.store.Snapshot()
	out := make([]ProjectView, 0, len(snap.Projects))
	for _, p := range snap.Projects {
		v := ProjectView{
			ID: p.ID, Name: p.Name, Path: p.Path,
			AddedAt: p.AddedAt, OpenedAt: p.OpenedAt,
		}
		if st, err := os.Stat(p.Path); err != nil || !st.IsDir() {
			v.Exists = false
			v.Summary = "找不到目录"
			out = append(out, v)
			continue
		}
		v.Exists = true
		st, err := s.git.Status(ctx, p.Path)
		if err != nil {
			v.Summary = "无法读取状态"
			v.Blockers = []string{err.Error()}
		} else {
			v.Branch = st.Health.Branch
			v.ChangeCount = len(st.Files)
			v.Blockers = st.Health.Blockers
			if len(st.Files) == 0 {
				v.Summary = "无修改"
			} else {
				v.Summary = fmt.Sprintf("%d 个修改", len(st.Files))
			}
		}
		out = append(out, v)
	}
	return out, nil
}

type AddRequest struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	Init     bool   `json:"init"`
	Create   bool   `json:"create"` // create new empty folder under parent? Path is target.
	ResetGit bool   `json:"resetGit"`
}

type InspectResult struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	IsRepo bool   `json:"isRepo"`
	Bare   bool   `json:"bare"`
	Exists bool   `json:"exists"`
	IsDir  bool   `json:"isDir"`
}

func (s *Service) Inspect(ctx context.Context, path string) (InspectResult, error) {
	path = filepath.Clean(path)
	if path == "" || path == "." {
		return InspectResult{}, fmt.Errorf("路径无效")
	}
	st, err := os.Stat(path)
	if err != nil {
		return InspectResult{}, fmt.Errorf("无法访问路径：%w", err)
	}
	if !st.IsDir() {
		return InspectResult{}, fmt.Errorf("请选择文件夹")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err == nil {
		path = resolved
	}
	out := InspectResult{Path: path, Name: filepath.Base(path), Exists: true, IsDir: true}
	if isRepo, _ := s.git.IsRepo(ctx, path); isRepo {
		out.IsRepo = true
		health, _ := s.git.Health(ctx, path)
		out.Bare = health.Bare
	}
	return out, nil
}

func (s *Service) Add(ctx context.Context, req AddRequest) (ProjectView, error) {
	path := filepath.Clean(req.Path)
	if path == "" || path == "." {
		return ProjectView{}, fmt.Errorf("路径无效")
	}
	name := strings.TrimSpace(req.Name)
	if req.Create {
		if name == "" {
			return ProjectView{}, fmt.Errorf("请填写项目名称")
		}
		// Path is parent directory; create child folder.
		path = filepath.Join(path, name)
		if _, err := os.Stat(path); err == nil {
			return ProjectView{}, fmt.Errorf("目标目录已存在，请更换名称")
		}
		if err := os.MkdirAll(path, 0o755); err != nil {
			return ProjectView{}, fmt.Errorf("创建目录失败：%w", err)
		}
	}
	st, err := os.Stat(path)
	if err != nil {
		return ProjectView{}, fmt.Errorf("无法访问路径：%w", err)
	}
	if !st.IsDir() {
		return ProjectView{}, fmt.Errorf("请选择文件夹")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err == nil {
		path = resolved
	}

	// Duplicate check
	for _, p := range s.store.Snapshot().Projects {
		if samePath(p.Path, path) {
			return ProjectView{}, fmt.Errorf("该文件夹已在项目列表中")
		}
	}

	isRepo, _ := s.git.IsRepo(ctx, path)
	if isRepo && req.ResetGit {
		if err := resetGitHistory(path); err != nil {
			return ProjectView{}, err
		}
		if err := s.git.InitRepo(ctx, path); err != nil {
			return ProjectView{}, fmt.Errorf("重新初始化 Git 失败：%w", err)
		}
	} else if isRepo {
		health, _ := s.git.Health(ctx, path)
		if health.Bare {
			return ProjectView{}, fmt.Errorf("不支持 bare 仓库")
		}
	} else if req.Init || req.Create || req.ResetGit {
		if err := s.git.InitRepo(ctx, path); err != nil {
			return ProjectView{}, fmt.Errorf("初始化 Git 失败：%w", err)
		}
	} else {
		return ProjectView{}, fmt.Errorf("该文件夹还不是 Git 仓库，请确认初始化")
	}

	if name == "" {
		name = filepath.Base(path)
	}
	id := session.RandomURLSafe(12)
	now := time.Now()
	entry := config.ProjectEntry{ID: id, Name: name, Path: path, AddedAt: now, OpenedAt: now}
	err = s.store.Save(func(f *config.File) error {
		f.Projects = append([]config.ProjectEntry{entry}, f.Projects...)
		return nil
	})
	if err != nil {
		return ProjectView{}, err
	}
	return ProjectView{ID: id, Name: name, Path: path, AddedAt: now, OpenedAt: now, Exists: true, Summary: "无修改"}, nil
}

func resetGitHistory(path string) error {
	gitDir := filepath.Join(path, ".git")
	st, err := os.Stat(gitDir)
	if err != nil {
		return fmt.Errorf("无法清空 Git 历史：%w", err)
	}
	if !st.IsDir() {
		return fmt.Errorf("当前仓库使用外部 .git 文件，暂不支持清空重新提交")
	}
	if err := os.RemoveAll(gitDir); err != nil {
		return fmt.Errorf("清空 Git 历史失败：%w", err)
	}
	return nil
}

func (s *Service) Remove(id string) error {
	return s.store.Save(func(f *config.File) error {
		next := f.Projects[:0]
		found := false
		for _, p := range f.Projects {
			if p.ID == id {
				found = true
				continue
			}
			next = append(next, p)
		}
		if !found {
			return fmt.Errorf("项目不存在")
		}
		f.Projects = next
		return nil
	})
}

func (s *Service) Get(id string) (config.ProjectEntry, error) {
	for _, p := range s.store.Snapshot().Projects {
		if p.ID == id {
			return p, nil
		}
	}
	return config.ProjectEntry{}, fmt.Errorf("项目不存在")
}

func (s *Service) TouchOpened(id string) {
	_ = s.store.Save(func(f *config.File) error {
		for i := range f.Projects {
			if f.Projects[i].ID == id {
				f.Projects[i].OpenedAt = time.Now()
				break
			}
		}
		return nil
	})
}

func (s *Service) Relocate(id, newPath string) error {
	newPath = filepath.Clean(newPath)
	st, err := os.Stat(newPath)
	if err != nil || !st.IsDir() {
		return fmt.Errorf("新路径无效")
	}
	ok, _ := s.git.IsRepo(context.Background(), newPath)
	if !ok {
		return fmt.Errorf("新路径不是 Git 仓库")
	}
	return s.store.Save(func(f *config.File) error {
		for i := range f.Projects {
			if f.Projects[i].ID == id {
				f.Projects[i].Path = newPath
				return nil
			}
		}
		return fmt.Errorf("项目不存在")
	})
}

func samePath(a, b string) bool {
	ra, err1 := filepath.EvalSymlinks(a)
	rb, err2 := filepath.EvalSymlinks(b)
	if err1 == nil {
		a = ra
	}
	if err2 == nil {
		b = rb
	}
	return filepath.Clean(a) == filepath.Clean(b)
}
