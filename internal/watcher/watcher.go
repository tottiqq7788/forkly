package watcher

import (
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type Manager struct {
	mu       sync.Mutex
	watchers map[string]*fsnotify.Watcher
	timers   map[string]*time.Timer
	onChange func(projectID string)
	debounce time.Duration
}

func New(onChange func(projectID string)) *Manager {
	return &Manager{
		watchers: map[string]*fsnotify.Watcher{},
		timers:   map[string]*time.Timer{},
		onChange: onChange,
		debounce: 400 * time.Millisecond,
	}
}

func (m *Manager) Watch(projectID, root string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.watchers[projectID]; ok {
		return nil
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	// Watch root and .git for state changes; recursive best-effort.
	_ = w.Add(root)
	_ = w.Add(filepath.Join(root, ".git"))
	_ = addRecursive(w, root, 3) // limited depth to avoid huge trees
	m.watchers[projectID] = w
	go m.loop(projectID, w)
	return nil
}

func addRecursive(w *fsnotify.Watcher, root string, depth int) error {
	if depth <= 0 {
		return nil
	}
	entries, err := filepath.Glob(filepath.Join(root, "*"))
	if err != nil {
		return err
	}
	for _, e := range entries {
		base := filepath.Base(e)
		if base == ".git" || base == "node_modules" || base == "dist" || base == ".next" {
			continue
		}
		info, err := osStat(e)
		if err != nil || !info.IsDir() {
			continue
		}
		_ = w.Add(e)
		_ = addRecursive(w, e, depth-1)
	}
	return nil
}

var osStat = func(p string) (interface{ IsDir() bool }, error) {
	return osStatFile(p)
}

func (m *Manager) loop(projectID string, w *fsnotify.Watcher) {
	for {
		select {
		case ev, ok := <-w.Events:
			if !ok {
				return
			}
			if ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename|fsnotify.Chmod) != 0 {
				m.schedule(projectID)
			}
		case _, ok := <-w.Errors:
			if !ok {
				return
			}
			m.schedule(projectID)
		}
	}
}

func (m *Manager) schedule(projectID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.timers[projectID]; ok {
		t.Stop()
	}
	m.timers[projectID] = time.AfterFunc(m.debounce, func() {
		if m.onChange != nil {
			m.onChange(projectID)
		}
	})
}

func (m *Manager) Unwatch(projectID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if w, ok := m.watchers[projectID]; ok {
		_ = w.Close()
		delete(m.watchers, projectID)
	}
	if t, ok := m.timers[projectID]; ok {
		t.Stop()
		delete(m.timers, projectID)
	}
}

func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, w := range m.watchers {
		_ = w.Close()
		delete(m.watchers, id)
	}
}
