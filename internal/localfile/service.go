package localfile

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/forkly-app/forkly/internal/gitexec"
	"github.com/forkly-app/forkly/internal/session"
)

// Meta is the public description of an opened local Markdown file.
type Meta struct {
	FileID      string `json:"fileId"`
	Name        string `json:"name"`
	DisplayPath string `json:"displayPath"`
	AbsPath     string `json:"absPath"`
	ParentName  string `json:"parentName"`
	Editable    bool   `json:"editable"`
	Revision    string `json:"revision,omitempty"`
	Size        int64  `json:"size,omitempty"`
}

type entry struct {
	ID       string
	AbsPath  string
	RootDir  string
	RelPath  string
	OpenedAt time.Time
}

// Service keeps an in-memory registry of absolute Markdown paths keyed by opaque IDs.
type Service struct {
	mu      sync.RWMutex
	byID    map[string]*entry
	byPath  map[string]string
	git     *gitexec.Executor
	ttl     time.Duration
}

func NewService(git *gitexec.Executor) *Service {
	s := &Service{
		byID:   map[string]*entry{},
		byPath: map[string]string{},
		git:    git,
		ttl:    12 * time.Hour,
	}
	go s.reap()
	return s
}

func (s *Service) Open(absPath string) (Meta, error) {
	normalized, root, rel, err := normalizeMarkdownFile(absPath)
	if err != nil {
		return Meta{}, err
	}
	fc, err := s.git.ReadContent(context.Background(), root, gitexec.SourceWorktree, rel)
	if err != nil {
		return Meta{}, err
	}
	if !fc.Editable {
		if fc.Message != "" {
			return Meta{}, fmt.Errorf("%s", fc.Message)
		}
		return Meta{}, fmt.Errorf("文件不可编辑")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if id, ok := s.byPath[normalized]; ok {
		if e := s.byID[id]; e != nil {
			e.OpenedAt = time.Now()
			return metaFrom(e, fc), nil
		}
	}
	id := session.RandomURLSafe(16)
	e := &entry{
		ID:       id,
		AbsPath:  normalized,
		RootDir:  root,
		RelPath:  rel,
		OpenedAt: time.Now(),
	}
	s.byID[id] = e
	s.byPath[normalized] = id
	return metaFrom(e, fc), nil
}

func (s *Service) Get(fileID string) (Meta, error) {
	e, err := s.lookup(fileID)
	if err != nil {
		return Meta{}, err
	}
	fc, err := s.git.ReadContent(context.Background(), e.RootDir, gitexec.SourceWorktree, e.RelPath)
	if err != nil {
		return Meta{}, err
	}
	return metaFrom(e, fc), nil
}

func (s *Service) ReadContent(ctx context.Context, fileID string) (gitexec.FileContent, Meta, error) {
	e, err := s.lookup(fileID)
	if err != nil {
		return gitexec.FileContent{}, Meta{}, err
	}
	fc, err := s.git.ReadContent(ctx, e.RootDir, gitexec.SourceWorktree, e.RelPath)
	if err != nil {
		return gitexec.FileContent{}, Meta{}, err
	}
	return fc, metaFrom(e, fc), nil
}

func (s *Service) WriteContent(fileID, content, expectedRevision string) (gitexec.WriteContentResult, error) {
	e, err := s.lookup(fileID)
	if err != nil {
		return gitexec.WriteContentResult{}, err
	}
	return s.git.WriteContent(e.RootDir, e.RelPath, content, expectedRevision)
}

func (s *Service) ReadAsset(ctx context.Context, fileID, rel string) (mime string, data []byte, revision string, err error) {
	e, err := s.lookup(fileID)
	if err != nil {
		return "", nil, "", err
	}
	return s.git.ReadAssetBytes(ctx, e.RootDir, gitexec.SourceWorktree, rel)
}

func (s *Service) WriteAsset(fileID, preferredName string, data []byte) (gitexec.WriteAssetResult, error) {
	e, err := s.lookup(fileID)
	if err != nil {
		return gitexec.WriteAssetResult{}, err
	}
	return s.git.WriteAsset(e.RootDir, e.RelPath, preferredName, data)
}

// OpenRelative opens a Markdown file relative to the current file's directory tree.
func (s *Service) OpenRelative(fileID, rel string) (Meta, error) {
	e, err := s.lookup(fileID)
	if err != nil {
		return Meta{}, err
	}
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return Meta{}, fmt.Errorf("缺少 path")
	}
	baseDir := filepath.ToSlash(filepath.Dir(e.RelPath))
	joined := rel
	if baseDir != "." && baseDir != "" {
		joined = filepath.ToSlash(filepath.Join(baseDir, rel))
	}
	abs := filepath.Clean(filepath.Join(e.RootDir, filepath.FromSlash(joined)))
	rootClean := filepath.Clean(e.RootDir)
	sep := string(filepath.Separator)
	if abs != rootClean && !strings.HasPrefix(abs, rootClean+sep) {
		return Meta{}, fmt.Errorf("路径超出当前文件目录")
	}
	return s.Open(abs)
}

func (s *Service) lookup(fileID string) (*entry, error) {
	fileID = strings.TrimSpace(fileID)
	if fileID == "" {
		return nil, fmt.Errorf("缺少 fileId")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	e := s.byID[fileID]
	if e == nil {
		return nil, fmt.Errorf("文件会话不存在或已失效")
	}
	if time.Since(e.OpenedAt) > s.ttl {
		return nil, fmt.Errorf("文件会话不存在或已失效")
	}
	return e, nil
}

func (s *Service) reap() {
	t := time.NewTicker(10 * time.Minute)
	for range t.C {
		now := time.Now()
		s.mu.Lock()
		for id, e := range s.byID {
			if now.Sub(e.OpenedAt) > s.ttl {
				delete(s.byID, id)
				delete(s.byPath, e.AbsPath)
			}
		}
		s.mu.Unlock()
	}
}

func metaFrom(e *entry, fc gitexec.FileContent) Meta {
	parent := filepath.Base(e.RootDir)
	display := e.RelPath
	if parent != "" && parent != "." && parent != string(filepath.Separator) {
		display = parent + "/" + e.RelPath
	}
	return Meta{
		FileID:      e.ID,
		Name:        filepath.Base(e.AbsPath),
		DisplayPath: display,
		AbsPath:     e.AbsPath,
		ParentName:  parent,
		Editable:    fc.Editable,
		Revision:    fc.Revision,
		Size:        fc.Size,
	}
}

func normalizeMarkdownFile(absPath string) (normalized, root, rel string, err error) {
	absPath = strings.TrimSpace(absPath)
	if absPath == "" {
		return "", "", "", fmt.Errorf("缺少文件路径")
	}
	absPath, err = filepath.Abs(absPath)
	if err != nil {
		return "", "", "", fmt.Errorf("路径无效")
	}
	resolved, err := filepath.EvalSymlinks(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", "", "", fmt.Errorf("文件不存在")
		}
		return "", "", "", fmt.Errorf("无法访问文件")
	}
	info, err := os.Lstat(resolved)
	if err != nil {
		return "", "", "", fmt.Errorf("无法访问文件")
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", "", "", fmt.Errorf("不支持编辑符号链接")
	}
	if !info.Mode().IsRegular() {
		return "", "", "", fmt.Errorf("路径不是普通文件")
	}
	if !gitexec.IsMarkdownPath(resolved) {
		return "", "", "", fmt.Errorf("仅支持打开 Markdown 文件")
	}
	if info.Size() > gitexec.MaxEditBytes {
		return "", "", "", fmt.Errorf("内容超过编辑上限")
	}
	root = filepath.Dir(resolved)
	rel = filepath.Base(resolved)
	return resolved, root, rel, nil
}
