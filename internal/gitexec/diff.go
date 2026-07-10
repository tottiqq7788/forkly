package gitexec

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	MaxDiffBytes   = 2 << 20 // 2 MiB
	MaxDiffLines   = 5000
	MaxImageBytes  = 8 << 20
)

type DiffKind string

const (
	DiffText   DiffKind = "text"
	DiffImage  DiffKind = "image"
	DiffBinary DiffKind = "binary"
	DiffTooLarge DiffKind = "too_large"
)

type DiffResult struct {
	Path       string   `json:"path"`
	Kind       DiffKind `json:"kind"`
	Patch      string   `json:"patch,omitempty"`
	Truncated  bool     `json:"truncated,omitempty"`
	Additions  int      `json:"additions,omitempty"`
	Deletions  int      `json:"deletions,omitempty"`
	OldImage   string   `json:"oldImage,omitempty"` // data URL
	NewImage   string   `json:"newImage,omitempty"`
	OldSize    int64    `json:"oldSize,omitempty"`
	NewSize    int64    `json:"newSize,omitempty"`
	Mime       string   `json:"mime,omitempty"`
	Message    string   `json:"message,omitempty"`
}

func (e *Executor) DiffFile(ctx context.Context, repo, path string) (DiffResult, error) {
	path = filepath.ToSlash(path)
	if err := assertInsideRepo(repo, path); err != nil {
		return DiffResult{}, err
	}
	abs := filepath.Join(repo, filepath.FromSlash(path))
	kind := classifyPath(path, abs)

	switch kind {
	case DiffImage:
		return e.diffImage(ctx, repo, path, abs)
	case DiffBinary:
		st, _ := os.Stat(abs)
		var size int64
		if st != nil {
			size = st.Size()
		}
		return DiffResult{
			Path: path, Kind: DiffBinary, NewSize: size, Mime: mimeByExt(path),
			Message: "二进制文件，仅显示元数据",
		}, nil
	default:
		return e.diffText(ctx, repo, path)
	}
}

func (e *Executor) diffText(ctx context.Context, repo, path string) (DiffResult, error) {
	// Prefer worktree vs HEAD; for untracked, show as all additions via /dev/null.
	args := []string{"diff", "--no-ext-diff", "--unified=3", "-z", "--", path}
	res, err := e.Run(ctx, RunOpts{Repo: repo, Args: args, Timeout: 30 * time.Second})
	patch := string(res.Stdout)
	if err != nil && len(res.Stdout) == 0 {
		// try staged
		res2, err2 := e.Run(ctx, RunOpts{Repo: repo, Args: []string{"diff", "--cached", "--no-ext-diff", "--unified=3", "--", path}, Timeout: 30 * time.Second})
		if err2 == nil {
			patch = string(res2.Stdout)
			err = nil
		}
	}
	if patch == "" {
		// untracked: invent a simple patch from file content
		abs := filepath.Join(repo, filepath.FromSlash(path))
		data, rerr := os.ReadFile(abs)
		if rerr == nil && utf8.Valid(data) && len(data) < MaxDiffBytes {
			var b strings.Builder
			b.WriteString("--- /dev/null\n+++ b/" + path + "\n")
			lines := strings.Split(string(data), "\n")
			fmt.Fprintf(&b, "@@ -0,0 +1,%d @@\n", len(lines))
			for _, ln := range lines {
				b.WriteString("+" + ln + "\n")
			}
			patch = b.String()
			err = nil
		}
	}
	if err != nil && patch == "" {
		return DiffResult{}, err
	}
	out := DiffResult{Path: path, Kind: DiffText, Patch: patch}
	out.Additions, out.Deletions = countDiffStats(patch)
	if len(patch) > MaxDiffBytes || strings.Count(patch, "\n") > MaxDiffLines {
		lines := strings.Split(patch, "\n")
		if len(lines) > MaxDiffLines {
			lines = lines[:MaxDiffLines]
		}
		joined := strings.Join(lines, "\n")
		if len(joined) > MaxDiffBytes {
			joined = joined[:MaxDiffBytes]
		}
		out.Patch = joined + "\n\n… 差异过大，已截断"
		out.Truncated = true
		out.Kind = DiffTooLarge
	}
	return out, nil
}

func (e *Executor) diffImage(ctx context.Context, repo, path, abs string) (DiffResult, error) {
	out := DiffResult{Path: path, Kind: DiffImage, Mime: mimeByExt(path)}
	if st, err := os.Stat(abs); err == nil {
		out.NewSize = st.Size()
		if st.Size() <= MaxImageBytes {
			if data, err := os.ReadFile(abs); err == nil {
				out.NewImage = dataURL(mimeByExt(path), data)
			}
		} else {
			out.Message = "当前图片过大，无法预览"
		}
	}
	// Old from HEAD
	res, err := e.Run(ctx, RunOpts{
		Repo: repo,
		Args: []string{"show", "HEAD:" + path},
		Timeout: 20 * time.Second,
	})
	if err == nil && len(res.Stdout) > 0 && len(res.Stdout) <= MaxImageBytes {
		out.OldSize = int64(len(res.Stdout))
		out.OldImage = dataURL(mimeByExt(path), res.Stdout)
	}
	return out, nil
}

func countDiffStats(patch string) (add, del int) {
	for _, line := range strings.Split(patch, "\n") {
		if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
			add++
		}
		if strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---") {
			del++
		}
	}
	return
}

func classifyPath(path, abs string) DiffKind {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		return DiffImage
	case ".svg":
		return DiffBinary // do not render SVG as active content
	}
	if st, err := os.Stat(abs); err == nil {
		if st.Size() > MaxDiffBytes {
			// peek
			f, err := os.Open(abs)
			if err == nil {
				buf := make([]byte, 8000)
				n, _ := f.Read(buf)
				_ = f.Close()
				if n > 0 && !utf8.Valid(buf[:n]) || bytes.IndexByte(buf[:n], 0) >= 0 {
					return DiffBinary
				}
			}
		} else {
			data, err := os.ReadFile(abs)
			if err == nil && (bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data)) {
				return DiffBinary
			}
		}
	}
	return DiffText
}

func mimeByExt(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".pdf":
		return "application/pdf"
	default:
		return http.DetectContentType([]byte{})
	}
}

func dataURL(mime string, data []byte) string {
	if mime == "" {
		mime = http.DetectContentType(data)
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}

func assertInsideRepo(repo, rel string) error {
	clean := filepath.Clean(filepath.FromSlash(rel))
	if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return fmt.Errorf("path escapes repository")
	}
	abs := filepath.Join(repo, clean)
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		// file may be deleted
		parent, err2 := filepath.EvalSymlinks(filepath.Dir(abs))
		if err2 != nil {
			return nil // allow deleted paths for diff
		}
		repoResolved, err3 := filepath.EvalSymlinks(repo)
		if err3 != nil {
			return err3
		}
		if !strings.HasPrefix(parent, repoResolved) {
			return fmt.Errorf("path escapes repository")
		}
		return nil
	}
	repoResolved, err := filepath.EvalSymlinks(repo)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(resolved, repoResolved+string(os.PathSeparator)) && resolved != repoResolved {
		return fmt.Errorf("path escapes repository")
	}
	return nil
}
