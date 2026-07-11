package gitexec

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	DefaultTreeLimit = 200
	MaxTreeLimit     = 1000
)

type BrowseSource string

const (
	SourceWorktree BrowseSource = "worktree"
	SourceHead     BrowseSource = "head"
)

type TreeEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Kind       string `json:"kind"` // file | dir | symlink
	Size       int64  `json:"size,omitempty"`
	LinkTarget string `json:"linkTarget,omitempty"`
}

type TreeListing struct {
	Path       string       `json:"path"`
	Source     BrowseSource `json:"source"`
	Entries    []TreeEntry  `json:"entries"`
	Offset     int          `json:"offset"`
	Limit      int          `json:"limit"`
	HasMore    bool         `json:"hasMore"`
	NextOffset int          `json:"nextOffset,omitempty"`
	EmptyHead  bool         `json:"emptyHead,omitempty"`
}

type FileContent struct {
	Path            string       `json:"path"`
	Source          BrowseSource `json:"source"`
	Kind            DiffKind     `json:"kind"`
	Mime            string       `json:"mime,omitempty"`
	Size            int64        `json:"size,omitempty"`
	Content         string       `json:"content"`
	DataURL         string       `json:"dataUrl,omitempty"`
	Truncated       bool         `json:"truncated,omitempty"`
	Message         string       `json:"message,omitempty"`
	Revision        string       `json:"revision,omitempty"`
	Editable        bool         `json:"editable"`
	LineEnding      string       `json:"lineEnding,omitempty"`
	HasUtf8Bom      bool         `json:"hasUtf8Bom,omitempty"`
	HasFinalNewline bool         `json:"hasFinalNewline,omitempty"`
}

func ParseBrowseSource(s string) (BrowseSource, error) {
	switch strings.TrimSpace(s) {
	case "", string(SourceWorktree):
		return SourceWorktree, nil
	case string(SourceHead):
		return SourceHead, nil
	default:
		return "", fmt.Errorf("source 无效，请使用 worktree 或 head")
	}
}

func NormalizeTreeLimit(limit int) int {
	if limit <= 0 {
		return DefaultTreeLimit
	}
	if limit > MaxTreeLimit {
		return MaxTreeLimit
	}
	return limit
}

func (e *Executor) ListTree(ctx context.Context, repo string, source BrowseSource, rel string, offset, limit int, hideRules []string) (TreeListing, error) {
	rel, err := normalizeBrowsePath(rel)
	if err != nil {
		return TreeListing{}, err
	}
	limit = NormalizeTreeLimit(limit)
	if offset < 0 {
		offset = 0
	}
	out := TreeListing{Path: rel, Source: source, Offset: offset, Limit: limit, Entries: []TreeEntry{}}
	switch source {
	case SourceWorktree:
		entries, err := e.listWorktreeDir(repo, rel)
		if err != nil {
			return TreeListing{}, err
		}
		entries = FilterHiddenEntries(entries, hideRules)
		return paginateTree(out, entries, offset, limit), nil
	case SourceHead:
		entries, empty, err := e.listHeadDir(ctx, repo, rel)
		if err != nil {
			return TreeListing{}, err
		}
		out.EmptyHead = empty
		entries = FilterHiddenEntries(entries, hideRules)
		return paginateTree(out, entries, offset, limit), nil
	default:
		return TreeListing{}, fmt.Errorf("source 无效")
	}
}

// FilterHiddenEntries drops entries whose name or path matches any hide rule glob.
func FilterHiddenEntries(entries []TreeEntry, rules []string) []TreeEntry {
	if len(rules) == 0 {
		return entries
	}
	out := make([]TreeEntry, 0, len(entries))
	for _, entry := range entries {
		if MatchesHideRules(entry.Name, entry.Path, rules) {
			continue
		}
		out = append(out, entry)
	}
	return out
}

// MatchesHideRules reports whether name or relative path matches a rule.
// Rules use path.Match globs; blank lines and # comments are ignored.
func MatchesHideRules(name, relPath string, rules []string) bool {
	for _, rule := range rules {
		rule = strings.TrimSpace(rule)
		if rule == "" || strings.HasPrefix(rule, "#") {
			continue
		}
		if ok, err := path.Match(rule, name); err == nil && ok {
			return true
		}
		if relPath != "" {
			if ok, err := path.Match(rule, relPath); err == nil && ok {
				return true
			}
			base := filepath.Base(relPath)
			if base != name {
				if ok, err := path.Match(rule, base); err == nil && ok {
					return true
				}
			}
		}
	}
	return false
}

func (e *Executor) ReadContent(ctx context.Context, repo string, source BrowseSource, rel string) (FileContent, error) {
	rel, err := normalizeBrowsePath(rel)
	if err != nil {
		return FileContent{}, err
	}
	if rel == "" {
		return FileContent{}, fmt.Errorf("缺少 path")
	}
	switch source {
	case SourceWorktree:
		return e.readWorktreeFile(repo, rel)
	case SourceHead:
		return e.readHeadFile(ctx, repo, rel)
	default:
		return FileContent{}, fmt.Errorf("source 无效")
	}
}

func normalizeBrowsePath(rel string) (string, error) {
	rel = strings.TrimSpace(rel)
	rel = strings.TrimPrefix(rel, "./")
	rel = filepath.ToSlash(rel)
	if rel == "" || rel == "." {
		return "", nil
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))
	if clean == "." {
		return "", nil
	}
	if strings.HasPrefix(clean, "../") || clean == ".." || filepath.IsAbs(filepath.FromSlash(clean)) || strings.HasPrefix(clean, "/") {
		return "", fmt.Errorf("path escapes repository")
	}
	// Paths starting with "-" can be parsed as git CLI options.
	if strings.HasPrefix(clean, "-") || strings.Contains(clean, "/-") {
		base := filepath.Base(clean)
		if strings.HasPrefix(base, "-") {
			return "", fmt.Errorf("路径无效")
		}
	}
	if isGitMetaPath(clean) {
		return "", fmt.Errorf("不允许访问 .git")
	}
	return clean, nil
}

func isGitMetaPath(rel string) bool {
	rel = filepath.ToSlash(rel)
	lower := strings.ToLower(rel)
	if lower == ".git" || strings.HasPrefix(lower, ".git/") {
		return true
	}
	// Nested submodule / planted metadata dirs: docs/.git/config
	for _, part := range strings.Split(lower, "/") {
		if part == ".git" {
			return true
		}
	}
	return false
}

func relOrDot(rel string) string {
	if rel == "" {
		return "."
	}
	return rel
}

func paginateTree(out TreeListing, entries []TreeEntry, offset, limit int) TreeListing {
	sortTreeEntries(entries)
	if offset > len(entries) {
		offset = len(entries)
	}
	end := offset + limit
	if end > len(entries) {
		end = len(entries)
	}
	out.Offset = offset
	out.Limit = limit
	out.Entries = entries[offset:end]
	if end < len(entries) {
		out.HasMore = true
		out.NextOffset = end
	}
	return out
}

func sortTreeEntries(entries []TreeEntry) {
	sort.Slice(entries, func(i, j int) bool {
		di := entries[i].Kind == "dir"
		dj := entries[j].Kind == "dir"
		if di != dj {
			return di
		}
		return strings.Compare(strings.ToLower(entries[i].Name), strings.ToLower(entries[j].Name)) < 0
	})
}

func (e *Executor) listWorktreeDir(repo, rel string) ([]TreeEntry, error) {
	if err := assertInsideRepo(repo, relOrDot(rel)); err != nil {
		return nil, err
	}
	abs := repo
	if rel != "" {
		abs = filepath.Join(repo, filepath.FromSlash(rel))
	}
	st, err := os.Lstat(abs)
	if err != nil {
		return nil, fmt.Errorf("目录不存在")
	}
	if st.Mode()&os.ModeSymlink != 0 {
		resolved, err := filepath.EvalSymlinks(abs)
		if err != nil {
			return nil, fmt.Errorf("无法解析符号链接")
		}
		repoResolved, err := filepath.EvalSymlinks(repo)
		if err != nil {
			return nil, err
		}
		if !pathWithinRoot(resolved, repoResolved) {
			return nil, fmt.Errorf("path escapes repository")
		}
		st, err = os.Stat(abs)
		if err != nil {
			return nil, fmt.Errorf("目录不存在")
		}
	}
	if !st.IsDir() {
		return nil, fmt.Errorf("路径不是目录")
	}
	ents, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	out := make([]TreeEntry, 0, len(ents))
	for _, ent := range ents {
		name := ent.Name()
		if strings.EqualFold(name, ".git") {
			continue
		}
		childRel := name
		if rel != "" {
			childRel = rel + "/" + name
		}
		if isGitMetaPath(childRel) {
			continue
		}
		info, err := ent.Info()
		if err != nil {
			continue
		}
		entry := TreeEntry{Name: name, Path: childRel}
		mode := info.Mode()
		switch {
		case mode&os.ModeSymlink != 0:
			entry.Kind = "symlink"
			if target, err := os.Readlink(filepath.Join(abs, name)); err == nil {
				entry.LinkTarget = target
			}
		case info.IsDir():
			entry.Kind = "dir"
		default:
			entry.Kind = "file"
			entry.Size = info.Size()
		}
		out = append(out, entry)
	}
	return out, nil
}

func (e *Executor) listHeadDir(ctx context.Context, repo, rel string) ([]TreeEntry, bool, error) {
	hasHead, err := e.hasHead(ctx, repo)
	if err != nil {
		return nil, false, err
	}
	if !hasHead {
		return []TreeEntry{}, true, nil
	}
	args := []string{"ls-tree", "-z", "HEAD"}
	if rel != "" {
		args = append(args, "--", rel+"/")
	}
	res, err := e.Run(ctx, RunOpts{Repo: repo, Args: args, Timeout: 30 * time.Second})
	if err != nil && len(res.Stdout) == 0 {
		if rel != "" {
			check, _ := e.Run(ctx, RunOpts{
				Repo: repo, Args: []string{"ls-tree", "-z", "HEAD", "--", rel}, Timeout: 15 * time.Second,
			})
			if len(check.Stdout) > 0 {
				return nil, false, fmt.Errorf("路径不是目录")
			}
			return nil, false, fmt.Errorf("目录不存在")
		}
		return nil, false, err
	}
	if len(res.Stdout) == 0 && rel != "" {
		check, _ := e.Run(ctx, RunOpts{
			Repo: repo, Args: []string{"ls-tree", "-z", "HEAD", "--", rel}, Timeout: 15 * time.Second,
		})
		if len(check.Stdout) > 0 {
			return nil, false, fmt.Errorf("路径不是目录")
		}
		return nil, false, fmt.Errorf("目录不存在")
	}
	entries, err := parseLsTree(res.Stdout, rel)
	if err != nil {
		return nil, false, err
	}
	return entries, false, nil
}

func parseLsTree(data []byte, parent string) ([]TreeEntry, error) {
	parts := bytes.Split(data, []byte{0})
	out := make([]TreeEntry, 0, len(parts))
	prefix := ""
	if parent != "" {
		prefix = parent + "/"
	}
	for _, part := range parts {
		if len(part) == 0 {
			continue
		}
		tab := bytes.IndexByte(part, '\t')
		if tab < 0 {
			continue
		}
		meta := string(part[:tab])
		namePath := string(part[tab+1:])
		fields := strings.Fields(meta)
		if len(fields) < 3 {
			continue
		}
		mode, typ := fields[0], fields[1]
		name := namePath
		if prefix != "" && strings.HasPrefix(namePath, prefix) {
			name = strings.TrimPrefix(namePath, prefix)
		} else if i := strings.LastIndex(namePath, "/"); i >= 0 {
			name = namePath[i+1:]
		}
		if name == "" || strings.Contains(name, "/") {
			continue
		}
		full := name
		if parent != "" {
			full = parent + "/" + name
		}
		if isGitMetaPath(full) {
			continue
		}
		entry := TreeEntry{Name: name, Path: full}
		switch typ {
		case "tree":
			entry.Kind = "dir"
		case "blob":
			if mode == "120000" {
				entry.Kind = "symlink"
			} else {
				entry.Kind = "file"
			}
		case "commit":
			entry.Kind = "dir"
		default:
			entry.Kind = "file"
		}
		out = append(out, entry)
	}
	return out, nil
}

func (e *Executor) readWorktreeFile(repo, rel string) (FileContent, error) {
	abs := filepath.Join(repo, filepath.FromSlash(rel))
	st, err := os.Lstat(abs)
	if err != nil {
		return FileContent{}, fmt.Errorf("文件不存在")
	}
	if st.Mode()&os.ModeSymlink != 0 {
		resolved, err := filepath.EvalSymlinks(abs)
		if err != nil {
			return FileContent{}, fmt.Errorf("无法解析符号链接")
		}
		repoResolved, err := filepath.EvalSymlinks(repo)
		if err != nil {
			return FileContent{}, err
		}
		if !pathWithinRoot(resolved, repoResolved) {
			return FileContent{
				Path:    rel,
				Source:  SourceWorktree,
				Kind:    DiffBinary,
				Message: "符号链接指向仓库外，无法预览",
			}, nil
		}
		st, err = os.Stat(abs)
		if err != nil {
			return FileContent{}, fmt.Errorf("文件不存在")
		}
	} else if err := assertInsideRepo(repo, rel); err != nil {
		return FileContent{}, err
	}
	if st.IsDir() {
		return FileContent{}, fmt.Errorf("路径是目录")
	}
	size := st.Size()
	kind := classifyPath(rel, abs)
	out := FileContent{Path: rel, Source: SourceWorktree, Kind: kind, Size: size, Mime: mimeByExt(rel)}
	return fillContentFromFile(out, abs, size, kind)
}

func (e *Executor) readHeadFile(ctx context.Context, repo, rel string) (FileContent, error) {
	hasHead, err := e.hasHead(ctx, repo)
	if err != nil {
		return FileContent{}, err
	}
	if !hasHead {
		return FileContent{}, fmt.Errorf("当前分支还没有任何提交")
	}
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"ls-tree", "-z", "HEAD", "--", rel},
		Timeout: 15 * time.Second,
	})
	if err != nil || len(res.Stdout) == 0 {
		return FileContent{}, fmt.Errorf("文件不存在")
	}
	mode, typ, oid, _, ok := parseLsTreeEntry(res.Stdout)
	if !ok {
		return FileContent{}, fmt.Errorf("文件不存在")
	}
	if typ == "tree" || typ == "commit" {
		return FileContent{}, fmt.Errorf("路径是目录")
	}
	if typ != "blob" {
		return FileContent{}, fmt.Errorf("不支持的对象类型")
	}
	if err := assertObjectID(oid); err != nil {
		return FileContent{}, fmt.Errorf("对象标识无效")
	}
	if mode == "120000" {
		data, err := e.catBlob(ctx, repo, oid, 4096)
		if err != nil {
			return FileContent{}, err
		}
		return FileContent{
			Path:    rel,
			Source:  SourceHead,
			Kind:    DiffBinary,
			Size:    int64(len(data)),
			Message: "符号链接：" + string(data),
		}, nil
	}
	sizeRes, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"cat-file", "-s", oid},
		Timeout: 10 * time.Second,
	})
	if err != nil {
		return FileContent{}, err
	}
	size, err := strconv.ParseInt(strings.TrimSpace(string(sizeRes.Stdout)), 10, 64)
	if err != nil || size < 0 {
		return FileContent{}, fmt.Errorf("无法读取对象大小")
	}
	kind := classifyExtAndSize(rel, size)
	out := FileContent{Path: rel, Source: SourceHead, Kind: kind, Size: size, Mime: mimeByExt(rel)}
	switch kind {
	case DiffImage:
		if size > MaxImageBytes {
			out.Message = "图片过大，无法预览"
			return out, nil
		}
		data, err := e.catBlob(ctx, repo, oid, int(size))
		if err != nil {
			return FileContent{}, err
		}
		out.DataURL = dataURL(mimeByExt(rel), data)
		out.Revision = contentRevision(data)
		return out, nil
	case DiffBinary:
		out.Message = "二进制文件，仅显示元数据"
		return out, nil
	default:
		// Never fully materialize oversized blobs: Run() buffers all stdout.
		if size > MaxDiffBytes {
			out.Kind = DiffTooLarge
			out.Truncated = true
			out.Message = "文件过大，无法预览全文"
			out.Editable = false
			return out, nil
		}
		data, err := e.catBlob(ctx, repo, oid, int(size))
		if err != nil {
			return FileContent{}, err
		}
		if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
			out.Kind = DiffBinary
			out.Content = ""
			out.Message = "二进制文件，仅显示元数据"
			return out, nil
		}
		return enrichTextContent(out, data), nil
	}
}

func parseLsTreeEntry(data []byte) (mode, typ, oid, name string, ok bool) {
	part := data
	if i := bytes.IndexByte(data, 0); i >= 0 {
		part = data[:i]
	}
	tab := bytes.IndexByte(part, '\t')
	if tab < 0 {
		return "", "", "", "", false
	}
	fields := strings.Fields(string(part[:tab]))
	if len(fields) < 3 {
		return "", "", "", "", false
	}
	return fields[0], fields[1], fields[2], string(part[tab+1:]), true
}

func (e *Executor) catBlob(ctx context.Context, repo, oid string, maxBytes int) ([]byte, error) {
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"cat-file", "blob", oid},
		Timeout: 30 * time.Second,
	})
	if err != nil {
		return nil, err
	}
	data := res.Stdout
	if maxBytes > 0 && len(data) > maxBytes {
		data = data[:maxBytes]
	}
	return data, nil
}

func (e *Executor) hasHead(ctx context.Context, repo string) (bool, error) {
	res, err := e.Run(ctx, RunOpts{
		Repo:    repo,
		Args:    []string{"rev-parse", "--verify", "HEAD"},
		Timeout: 10 * time.Second,
	})
	if err != nil {
		msg := string(res.Stderr) + err.Error()
		if strings.Contains(msg, "unknown revision") ||
			strings.Contains(msg, "bad revision") ||
			strings.Contains(msg, "Needed a single revision") ||
			strings.Contains(msg, "ambiguous argument") {
			return false, nil
		}
		// empty repo often exits nonzero
		if len(res.Stdout) == 0 {
			return false, nil
		}
		return false, err
	}
	return strings.TrimSpace(string(res.Stdout)) != "", nil
}

func fillContentFromFile(out FileContent, abs string, size int64, kind DiffKind) (FileContent, error) {
	switch kind {
	case DiffImage:
		if size > MaxImageBytes {
			out.Message = "图片过大，无法预览"
			return out, nil
		}
		data, err := os.ReadFile(abs)
		if err != nil {
			return FileContent{}, fmt.Errorf("读取失败")
		}
		out.DataURL = dataURL(mimeByExt(out.Path), data)
		out.Revision = contentRevision(data)
		return out, nil
	case DiffBinary:
		out.Message = "二进制文件，仅显示元数据"
		return out, nil
	default:
		if size > MaxDiffBytes {
			f, err := os.Open(abs)
			if err != nil {
				return FileContent{}, fmt.Errorf("读取失败")
			}
			defer f.Close()
			buf := make([]byte, MaxDiffBytes)
			n, _ := io.ReadFull(f, buf)
			data := buf[:n]
			if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
				out.Kind = DiffBinary
				out.Message = "二进制文件，仅显示元数据"
				return out, nil
			}
			out.Kind = DiffTooLarge
			out.Truncated = true
			out.Content = string(data)
			out.Message = "文件过大，仅显示部分内容"
			out.Editable = false
			return out, nil
		}
		data, err := os.ReadFile(abs)
		if err != nil {
			return FileContent{}, fmt.Errorf("读取失败")
		}
		if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
			out.Kind = DiffBinary
			out.Message = "二进制文件，仅显示元数据"
			return out, nil
		}
		return enrichTextContent(out, data), nil
	}
}

func classifyExtAndSize(path string, size int64) DiffKind {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		return DiffImage
	case ".svg":
		return DiffBinary
	}
	if size > MaxDiffBytes*4 {
		// very large: treat as too large text until probed; still try text path with truncation
		return DiffText
	}
	return DiffText
}
