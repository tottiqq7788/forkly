package gitexec

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const (
	// MaxEditBytes is the hard limit for Markdown edits (1 MiB).
	MaxEditBytes = 1 << 20
	// MaxAssetUploadBytes caps pasted/dropped image uploads.
	MaxAssetUploadBytes = 8 << 20
)

var (
	ErrContentConflict = errors.New("content revision conflict")
	ErrNotEditable     = errors.New("file is not editable")
)

// ContentConflict carries both revisions for a structured 409 response.
type ContentConflict struct {
	Path             string
	ExpectedRevision string
	CurrentRevision  string
}

func (e *ContentConflict) Error() string {
	return "content revision conflict"
}

func (e *ContentConflict) Is(target error) bool {
	return target == ErrContentConflict
}

type WriteContentResult struct {
	Path     string `json:"path"`
	Revision string `json:"revision"`
	Size     int64  `json:"size"`
}

type WriteAssetResult struct {
	Path         string `json:"path"`
	RelativePath string `json:"relativePath"`
	Mime         string `json:"mime"`
	Size         int64  `json:"size"`
	Revision     string `json:"revision,omitempty"`
}

type textMeta struct {
	hasBOM          bool
	lineEnding      string // "lf" | "crlf" | "cr" | "mixed"
	hasFinalNewline bool
	normalized      string
	raw             []byte
	revision        string
}

func contentRevision(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func analyzeTextBytes(raw []byte) (textMeta, error) {
	meta := textMeta{raw: raw, revision: contentRevision(raw)}
	data := raw
	if bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}) {
		meta.hasBOM = true
		data = data[3:]
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return meta, fmt.Errorf("不是有效的 UTF-8 文本")
	}
	crlf := bytes.Count(data, []byte("\r\n"))
	stripped := bytes.ReplaceAll(data, []byte("\r\n"), nil)
	cr := bytes.Count(stripped, []byte("\r"))
	lf := bytes.Count(stripped, []byte("\n"))
	switch {
	case crlf > 0 && cr == 0 && lf == 0:
		meta.lineEnding = "crlf"
	case crlf == 0 && cr > 0 && lf == 0:
		meta.lineEnding = "cr"
	case crlf == 0 && cr == 0:
		meta.lineEnding = "lf"
	default:
		meta.lineEnding = "mixed"
	}
	meta.hasFinalNewline = len(data) == 0 || data[len(data)-1] == '\n' || data[len(data)-1] == '\r'
	norm := string(bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n")))
	norm = strings.ReplaceAll(norm, "\r", "\n")
	meta.normalized = norm
	return meta, nil
}

func applyTextMeta(content string, meta textMeta) []byte {
	body := content
	if meta.hasFinalNewline && body != "" && !strings.HasSuffix(body, "\n") {
		body += "\n"
	}
	if !meta.hasFinalNewline && strings.HasSuffix(body, "\n") {
		body = strings.TrimSuffix(body, "\n")
	}
	switch meta.lineEnding {
	case "crlf":
		body = strings.ReplaceAll(body, "\n", "\r\n")
	case "cr":
		body = strings.ReplaceAll(body, "\n", "\r")
	}
	out := []byte(body)
	if meta.hasBOM {
		out = append([]byte{0xEF, 0xBB, 0xBF}, out...)
	}
	return out
}

func enrichTextContent(out FileContent, raw []byte) FileContent {
	meta, err := analyzeTextBytes(raw)
	if err != nil {
		out.Kind = DiffBinary
		out.Content = ""
		out.Message = "二进制文件，仅显示元数据"
		out.Editable = false
		return out
	}
	out.Revision = meta.revision
	out.HasUtf8Bom = meta.hasBOM
	out.LineEnding = meta.lineEnding
	out.HasFinalNewline = meta.hasFinalNewline
	out.Content = meta.normalized
	// Any safe UTF-8 worktree text file is editable; Markdown is not required.
	editable := out.Source == SourceWorktree &&
		!out.Truncated &&
		out.Kind == DiffText &&
		out.Size <= MaxEditBytes &&
		out.Message == ""
	out.Editable = editable
	return out
}

func isMarkdownRel(rel string) bool {
	return IsMarkdownPath(rel)
}

// IsMarkdownPath reports whether path has a supported Markdown extension.
func IsMarkdownPath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".md", ".markdown", ".mdown", ".mkdn", ".mkd", ".mdwn", ".mdtxt", ".mdtext":
		return true
	default:
		return false
	}
}

// WriteContent atomically replaces a worktree UTF-8 text file when expectedRevision matches.
func (e *Executor) WriteContent(repo, rel, content, expectedRevision string) (WriteContentResult, error) {
	rel, err := normalizeBrowsePath(rel)
	if err != nil {
		return WriteContentResult{}, err
	}
	if rel == "" {
		return WriteContentResult{}, fmt.Errorf("缺少 path")
	}
	if isGitMetaPath(rel) {
		return WriteContentResult{}, fmt.Errorf("不允许访问 .git")
	}
	if int64(len(content)) > MaxEditBytes {
		return WriteContentResult{}, fmt.Errorf("内容超过编辑上限")
	}
	if !utf8.ValidString(content) {
		return WriteContentResult{}, fmt.Errorf("内容必须是 UTF-8 文本")
	}

	mu := e.writeLock(repo)
	mu.Lock()
	defer mu.Unlock()

	root, err := os.OpenRoot(repo)
	if err != nil {
		return WriteContentResult{}, err
	}
	defer root.Close()

	info, err := root.Lstat(rel)
	if err != nil {
		if os.IsNotExist(err) {
			return WriteContentResult{}, fmt.Errorf("文件不存在")
		}
		return WriteContentResult{}, fmt.Errorf("无法访问文件")
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return WriteContentResult{}, fmt.Errorf("不支持编辑符号链接")
	}
	if !info.Mode().IsRegular() {
		return WriteContentResult{}, fmt.Errorf("路径不是普通文件")
	}
	if info.Size() > MaxEditBytes {
		return WriteContentResult{}, ErrNotEditable
	}

	current, err := root.ReadFile(rel)
	if err != nil {
		return WriteContentResult{}, fmt.Errorf("读取失败")
	}
	meta, err := analyzeTextBytes(current)
	if err != nil {
		return WriteContentResult{}, ErrNotEditable
	}
	if expectedRevision == "" || meta.revision != expectedRevision {
		return WriteContentResult{}, &ContentConflict{
			Path:             rel,
			ExpectedRevision: expectedRevision,
			CurrentRevision:  meta.revision,
		}
	}

	payload := applyTextMeta(content, meta)
	if int64(len(payload)) > MaxEditBytes {
		return WriteContentResult{}, fmt.Errorf("内容超过编辑上限")
	}

	dir := path.Dir(rel)
	base := path.Base(rel)
	tmpName := "." + base + ".forkly-tmp"
	tmpRel := tmpName
	if dir != "." && dir != "" {
		tmpRel = path.Join(dir, tmpName)
	}

	tmp, err := root.OpenFile(tmpRel, os.O_CREATE|os.O_WRONLY|os.O_TRUNC|os.O_EXCL, info.Mode().Perm())
	if err != nil {
		tmpRel = fmt.Sprintf("%s.%d", tmpRel, os.Getpid())
		tmp, err = root.OpenFile(tmpRel, os.O_CREATE|os.O_WRONLY|os.O_TRUNC|os.O_EXCL, info.Mode().Perm())
		if err != nil {
			return WriteContentResult{}, fmt.Errorf("无法创建临时文件")
		}
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = root.Remove(tmpRel)
		}
	}()

	if _, err := tmp.Write(payload); err != nil {
		_ = tmp.Close()
		return WriteContentResult{}, fmt.Errorf("写入失败")
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return WriteContentResult{}, fmt.Errorf("写入失败")
	}
	if err := tmp.Close(); err != nil {
		return WriteContentResult{}, fmt.Errorf("写入失败")
	}

	if err := root.Rename(tmpRel, rel); err != nil {
		return WriteContentResult{}, fmt.Errorf("保存失败")
	}
	cleanup = false

	return WriteContentResult{
		Path:     rel,
		Revision: contentRevision(payload),
		Size:     int64(len(payload)),
	}, nil
}

var allowedAssetMIME = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

func sniffImageMIME(data []byte) (string, bool) {
	if len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}) {
		return "image/png", true
	}
	if len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return "image/jpeg", true
	}
	if len(data) >= 6 && (bytes.Equal(data[:6], []byte("GIF87a")) || bytes.Equal(data[:6], []byte("GIF89a"))) {
		return "image/gif", true
	}
	if len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")) {
		return "image/webp", true
	}
	return "", false
}

// WriteAsset stores an image beside the Markdown file under assets/.
func (e *Executor) WriteAsset(repo, markdownRel, preferredName string, data []byte) (WriteAssetResult, error) {
	markdownRel, err := normalizeBrowsePath(markdownRel)
	if err != nil {
		return WriteAssetResult{}, err
	}
	if markdownRel == "" {
		return WriteAssetResult{}, fmt.Errorf("缺少 path")
	}
	if int64(len(data)) == 0 {
		return WriteAssetResult{}, fmt.Errorf("空文件")
	}
	if int64(len(data)) > MaxAssetUploadBytes {
		return WriteAssetResult{}, fmt.Errorf("图片过大")
	}
	mime, ok := sniffImageMIME(data)
	if !ok {
		return WriteAssetResult{}, fmt.Errorf("不支持的图片类型")
	}
	ext := allowedAssetMIME[mime]

	mu := e.writeLock(repo)
	mu.Lock()
	defer mu.Unlock()

	root, err := os.OpenRoot(repo)
	if err != nil {
		return WriteAssetResult{}, err
	}
	defer root.Close()

	mdInfo, err := root.Lstat(markdownRel)
	if err != nil {
		return WriteAssetResult{}, fmt.Errorf("Markdown 文件不存在")
	}
	if mdInfo.Mode()&os.ModeSymlink != 0 || !mdInfo.Mode().IsRegular() {
		return WriteAssetResult{}, fmt.Errorf("Markdown 路径无效")
	}

	dir := path.Dir(markdownRel)
	assetsDir := "assets"
	if dir != "." && dir != "" {
		assetsDir = path.Join(dir, "assets")
	}
	if err := root.MkdirAll(assetsDir, 0o755); err != nil {
		return WriteAssetResult{}, fmt.Errorf("无法创建 assets 目录")
	}

	base := sanitizeAssetBase(preferredName)
	finalRel, err := uniqueAssetPath(root, assetsDir, base, ext)
	if err != nil {
		return WriteAssetResult{}, err
	}

	tmpRel := finalRel + ".forkly-tmp"
	tmp, err := root.OpenFile(tmpRel, os.O_CREATE|os.O_WRONLY|os.O_TRUNC|os.O_EXCL, 0o644)
	if err != nil {
		return WriteAssetResult{}, fmt.Errorf("无法创建临时文件")
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = root.Remove(tmpRel)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return WriteAssetResult{}, fmt.Errorf("写入失败")
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return WriteAssetResult{}, fmt.Errorf("写入失败")
	}
	if err := tmp.Close(); err != nil {
		return WriteAssetResult{}, fmt.Errorf("写入失败")
	}
	if err := root.Rename(tmpRel, finalRel); err != nil {
		return WriteAssetResult{}, fmt.Errorf("保存失败")
	}
	cleanup = false

	return WriteAssetResult{
		Path:         finalRel,
		RelativePath: path.Join("assets", path.Base(finalRel)),
		Mime:         mime,
		Size:         int64(len(data)),
		Revision:     contentRevision(data),
	}, nil
}

func sanitizeAssetBase(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	name = strings.ReplaceAll(name, "\\", "/")
	name = path.Base(name)
	if name == "." || name == ".." || name == "" {
		name = "image"
	}
	if i := strings.LastIndexByte(name, '.'); i >= 0 {
		name = name[:i]
	}
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		case r == ' ':
			b.WriteByte('-')
		}
	}
	out := b.String()
	if out == "" {
		out = "image"
	}
	if len(out) > 64 {
		out = out[:64]
	}
	return out
}

func uniqueAssetPath(root *os.Root, assetsDir, base, ext string) (string, error) {
	candidate := path.Join(assetsDir, base+ext)
	if _, err := root.Lstat(candidate); err != nil {
		if os.IsNotExist(err) {
			return candidate, nil
		}
		return "", fmt.Errorf("无法检查文件名")
	}
	for i := 1; i < 1000; i++ {
		candidate = path.Join(assetsDir, fmt.Sprintf("%s-%d%s", base, i, ext))
		if _, err := root.Lstat(candidate); err != nil {
			if os.IsNotExist(err) {
				return candidate, nil
			}
			return "", fmt.Errorf("无法检查文件名")
		}
	}
	return "", fmt.Errorf("无法生成唯一文件名")
}

// ReadAssetBytes returns whitelisted image bytes for worktree/head.
func (e *Executor) ReadAssetBytes(ctx context.Context, repo string, source BrowseSource, rel string) (mime string, data []byte, revision string, err error) {
	rel, err = normalizeBrowsePath(rel)
	if err != nil {
		return "", nil, "", err
	}
	if rel == "" {
		return "", nil, "", fmt.Errorf("缺少 path")
	}
	ext := strings.ToLower(filepath.Ext(rel))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
	default:
		return "", nil, "", fmt.Errorf("不支持的图片类型")
	}

	fc, err := e.ReadContent(ctx, repo, source, rel)
	if err != nil {
		return "", nil, "", err
	}
	if fc.Kind != DiffImage {
		return "", nil, "", fmt.Errorf("不是可预览图片")
	}
	mime = fc.Mime
	if mime == "" {
		mime = mimeByExt(rel)
	}
	switch mime {
	case "image/png", "image/jpeg", "image/gif", "image/webp":
	default:
		return "", nil, "", fmt.Errorf("不支持的图片类型")
	}

	if source == SourceWorktree {
		root, openErr := os.OpenRoot(repo)
		if openErr != nil {
			return "", nil, "", openErr
		}
		defer root.Close()
		raw, readErr := root.ReadFile(rel)
		if readErr != nil {
			return "", nil, "", fmt.Errorf("读取失败")
		}
		if int64(len(raw)) > MaxImageBytes {
			return "", nil, "", fmt.Errorf("图片过大")
		}
		if sniffed, ok := sniffImageMIME(raw); ok {
			mime = sniffed
		} else {
			return "", nil, "", fmt.Errorf("不是可预览图片")
		}
		return mime, raw, contentRevision(raw), nil
	}

	if fc.DataURL == "" {
		return "", nil, "", fmt.Errorf("无法读取图片")
	}
	const prefix = "base64,"
	i := strings.Index(fc.DataURL, prefix)
	if i < 0 {
		return "", nil, "", fmt.Errorf("无法读取图片")
	}
	raw, decErr := base64.StdEncoding.DecodeString(fc.DataURL[i+len(prefix):])
	if decErr != nil {
		return "", nil, "", fmt.Errorf("无法读取图片")
	}
	if sniffed, ok := sniffImageMIME(raw); ok {
		mime = sniffed
	} else {
		return "", nil, "", fmt.Errorf("不是可预览图片")
	}
	return mime, raw, contentRevision(raw), nil
}

// WriteAssetHTTP writes image bytes with ETag / cache headers.
func WriteAssetHTTP(w http.ResponseWriter, mime string, data []byte, revision string) {
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, no-cache")
	if revision != "" {
		w.Header().Set("ETag", `"`+revision+`"`)
	}
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	_, _ = w.Write(data)
}
