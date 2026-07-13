package gitexec

import (
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func validateEntryName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("名称不能为空")
	}
	if name == "." || name == ".." || strings.Contains(name, "/") || strings.Contains(name, "\\") {
		return "", fmt.Errorf("名称无效")
	}
	if strings.HasPrefix(name, "-") {
		return "", fmt.Errorf("名称无效")
	}
	if isGitMetaPath(name) {
		return "", fmt.Errorf("不允许访问 .git")
	}
	return name, nil
}

func parentDir(rel string) string {
	dir := path.Dir(rel)
	if dir == "." {
		return ""
	}
	return dir
}

func (e *Executor) ensureWritableParent(repo, parentRel string) (string, error) {
	parentRel, err := normalizeBrowsePath(parentRel)
	if err != nil {
		return "", err
	}
	if err := assertInsideRepo(repo, relOrDot(parentRel)); err != nil {
		return "", err
	}
	return parentRel, nil
}

func treeEntryFromInfo(root *os.Root, rel string, info os.FileInfo) TreeEntry {
	entry := TreeEntry{
		Name: path.Base(rel),
		Path: rel,
	}
	mode := info.Mode()
	switch {
	case mode&os.ModeSymlink != 0:
		entry.Kind = "symlink"
		if target, err := root.Readlink(rel); err == nil {
			entry.LinkTarget = target
		}
	case info.IsDir():
		entry.Kind = "dir"
	default:
		entry.Kind = "file"
		entry.Size = info.Size()
	}
	return entry
}

func (e *Executor) CreateFile(repo, parentRel, name string) (TreeEntry, error) {
	parentRel, err := e.ensureWritableParent(repo, parentRel)
	if err != nil {
		return TreeEntry{}, err
	}
	name, err = validateEntryName(name)
	if err != nil {
		return TreeEntry{}, err
	}
	rel := name
	if parentRel != "" {
		rel = path.Join(parentRel, name)
	}

	mu := e.writeLock(repo)
	mu.Lock()
	defer mu.Unlock()

	root, err := os.OpenRoot(repo)
	if err != nil {
		return TreeEntry{}, err
	}
	defer root.Close()

	parentInfo, err := root.Lstat(relOrDot(parentRel))
	if err != nil {
		return TreeEntry{}, fmt.Errorf("父目录不存在")
	}
	if !parentInfo.IsDir() || parentInfo.Mode()&os.ModeSymlink != 0 {
		return TreeEntry{}, fmt.Errorf("父路径不是目录")
	}

	file, err := root.OpenFile(rel, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return TreeEntry{}, fmt.Errorf("目标已存在")
		}
		return TreeEntry{}, fmt.Errorf("无法创建文件")
	}
	if err := file.Close(); err != nil {
		return TreeEntry{}, fmt.Errorf("无法创建文件")
	}
	info, err := root.Lstat(rel)
	if err != nil {
		return TreeEntry{}, fmt.Errorf("无法访问文件")
	}
	return treeEntryFromInfo(root, rel, info), nil
}

func (e *Executor) CreateFolder(repo, parentRel, name string) (TreeEntry, error) {
	parentRel, err := e.ensureWritableParent(repo, parentRel)
	if err != nil {
		return TreeEntry{}, err
	}
	name, err = validateEntryName(name)
	if err != nil {
		return TreeEntry{}, err
	}
	rel := name
	if parentRel != "" {
		rel = path.Join(parentRel, name)
	}

	mu := e.writeLock(repo)
	mu.Lock()
	defer mu.Unlock()

	root, err := os.OpenRoot(repo)
	if err != nil {
		return TreeEntry{}, err
	}
	defer root.Close()

	parentInfo, err := root.Lstat(relOrDot(parentRel))
	if err != nil {
		return TreeEntry{}, fmt.Errorf("父目录不存在")
	}
	if !parentInfo.IsDir() || parentInfo.Mode()&os.ModeSymlink != 0 {
		return TreeEntry{}, fmt.Errorf("父路径不是目录")
	}
	if err := root.Mkdir(rel, 0o755); err != nil {
		if os.IsExist(err) {
			return TreeEntry{}, fmt.Errorf("目标已存在")
		}
		return TreeEntry{}, fmt.Errorf("无法创建文件夹")
	}
	info, err := root.Lstat(rel)
	if err != nil {
		return TreeEntry{}, fmt.Errorf("无法访问文件夹")
	}
	return treeEntryFromInfo(root, rel, info), nil
}

func (e *Executor) RenameEntry(repo, rel, name string) (TreeEntry, error) {
	rel, err := normalizeBrowsePath(rel)
	if err != nil {
		return TreeEntry{}, err
	}
	if rel == "" {
		return TreeEntry{}, fmt.Errorf("不能重命名项目根目录")
	}
	name, err = validateEntryName(name)
	if err != nil {
		return TreeEntry{}, err
	}
	parentRel, err := e.ensureWritableParent(repo, parentDir(rel))
	if err != nil {
		return TreeEntry{}, err
	}
	nextRel := name
	if parentRel != "" {
		nextRel = path.Join(parentRel, name)
	}
	if rel == nextRel {
		info, err := os.Lstat(filepath.Join(repo, filepath.FromSlash(rel)))
		if err != nil {
			return TreeEntry{}, fmt.Errorf("路径不存在")
		}
		root, err := os.OpenRoot(repo)
		if err != nil {
			return TreeEntry{}, err
		}
		defer root.Close()
		return treeEntryFromInfo(root, rel, info), nil
	}

	mu := e.writeLock(repo)
	mu.Lock()
	defer mu.Unlock()

	root, err := os.OpenRoot(repo)
	if err != nil {
		return TreeEntry{}, err
	}
	defer root.Close()

	info, err := root.Lstat(rel)
	if err != nil {
		return TreeEntry{}, fmt.Errorf("路径不存在")
	}
	if _, err := root.Lstat(nextRel); err == nil {
		return TreeEntry{}, fmt.Errorf("目标已存在")
	} else if !os.IsNotExist(err) {
		return TreeEntry{}, fmt.Errorf("无法访问目标路径")
	}
	if err := root.Rename(rel, nextRel); err != nil {
		return TreeEntry{}, fmt.Errorf("重命名失败")
	}
	return treeEntryFromInfo(root, nextRel, info), nil
}

func (e *Executor) DeleteEntry(repo, rel string) error {
	rel, err := normalizeBrowsePath(rel)
	if err != nil {
		return err
	}
	if rel == "" {
		return fmt.Errorf("不能删除项目根目录")
	}
	if _, err := e.ensureWritableParent(repo, parentDir(rel)); err != nil {
		return err
	}

	mu := e.writeLock(repo)
	mu.Lock()
	defer mu.Unlock()

	root, err := os.OpenRoot(repo)
	if err != nil {
		return err
	}
	defer root.Close()

	info, err := root.Lstat(rel)
	if err != nil {
		return fmt.Errorf("路径不存在")
	}
	if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
		f, err := root.Open(rel)
		if err != nil {
			return fmt.Errorf("无法访问文件夹")
		}
		names, readErr := f.Readdirnames(1)
		_ = f.Close()
		if len(names) > 0 || (readErr != nil && readErr != io.EOF) {
			return fmt.Errorf("仅支持删除空文件夹")
		}
	}
	if err := root.Remove(rel); err != nil {
		if strings.Contains(err.Error(), "directory not empty") {
			return fmt.Errorf("仅支持删除空文件夹")
		}
		return fmt.Errorf("删除失败")
	}
	return nil
}

func (e *Executor) ResolveWorktreePath(repo, rel string) (string, error) {
	rel, err := normalizeBrowsePath(rel)
	if err != nil {
		return "", err
	}
	if err := assertInsideRepo(repo, relOrDot(rel)); err != nil {
		return "", err
	}
	if rel == "" {
		return repo, nil
	}
	return filepath.Join(repo, filepath.FromSlash(rel)), nil
}
