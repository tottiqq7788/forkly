package diagnostics

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/forkly-app/forkly/internal/config"
)

type Logger struct {
	*slog.Logger
	file   *os.File
	dir    string
	mu     sync.Mutex
	closed bool
}

func NewLogger() (*Logger, error) {
	dir, err := config.DefaultLogDir()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "forkly.log")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	// Rotate if larger than 5MB.
	if info, err := f.Stat(); err == nil && info.Size() > 5<<20 {
		_ = f.Close()
		rotated := filepath.Join(dir, fmt.Sprintf("forkly-%s.log", time.Now().Format("20060102-150405")))
		_ = os.Rename(path, rotated)
		f, err = os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			return nil, err
		}
	}
	mw := io.MultiWriter(os.Stderr, f)
	h := slog.NewJSONHandler(mw, &slog.HandlerOptions{Level: slog.LevelInfo})
	return &Logger{Logger: slog.New(h), file: f, dir: dir}, nil
}

func (l *Logger) Dir() string { return l.dir }

func (l *Logger) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return nil
	}
	l.closed = true
	return l.file.Close()
}

func (l *Logger) Error(msg string, args ...any) { l.Logger.Error(msg, args...) }
func (l *Logger) Info(msg string, args ...any)  { l.Logger.Info(msg, args...) }
func (l *Logger) Warn(msg string, args ...any)  { l.Logger.Warn(msg, args...) }
