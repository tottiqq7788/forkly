package watcher

import (
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type RenamePair struct {
	Old string
	New string
}

type pendingRemove struct {
	path string
	at   time.Time
}

type projectTrack struct {
	root    string
	pending []pendingRemove
	pairs   []RenamePair // confirmed old -> new
}

type Manager struct {
	mu       sync.Mutex
	watchers map[string]*fsnotify.Watcher
	tracks   map[string]*projectTrack
	timers   map[string]*time.Timer
	onChange func(projectID string)
	debounce time.Duration
	pairTTL  time.Duration
}

func New(onChange func(projectID string)) *Manager {
	return &Manager{
		watchers: map[string]*fsnotify.Watcher{},
		tracks:   map[string]*projectTrack{},
		timers:   map[string]*time.Timer{},
		onChange: onChange,
		debounce: 400 * time.Millisecond,
		pairTTL:  3 * time.Second,
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
	abs, err := filepath.Abs(root)
	if err != nil {
		abs = root
	}
	_ = w.Add(abs)
	_ = w.Add(filepath.Join(abs, ".git"))
	_ = addRecursive(w, abs, 3)
	m.watchers[projectID] = w
	m.tracks[projectID] = &projectTrack{root: abs}
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
			m.handleEvent(projectID, ev)
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

func (m *Manager) handleEvent(projectID string, ev fsnotify.Event) {
	m.mu.Lock()
	defer m.mu.Unlock()
	tr, ok := m.tracks[projectID]
	if !ok {
		return
	}
	rel, ok := relPath(tr.root, ev.Name)
	if !ok {
		return
	}
	now := time.Now()
	m.pruneLocked(tr, now)

	switch {
	case ev.Op&fsnotify.Rename != 0 || ev.Op&fsnotify.Remove != 0:
		tr.pending = append(tr.pending, pendingRemove{path: rel, at: now})
	case ev.Op&fsnotify.Create != 0:
		m.pairCreateLocked(tr, rel, now)
	}
}

func (m *Manager) pruneLocked(tr *projectTrack, now time.Time) {
	kept := tr.pending[:0]
	for _, p := range tr.pending {
		if now.Sub(p.at) <= m.pairTTL {
			kept = append(kept, p)
		}
	}
	tr.pending = kept
}

// ObservedRenames returns confirmed rename pairs for a project.
func (m *Manager) ObservedRenames(projectID string) []RenamePair {
	m.mu.Lock()
	defer m.mu.Unlock()
	tr, ok := m.tracks[projectID]
	if !ok {
		return nil
	}
	out := make([]RenamePair, len(tr.pairs))
	copy(out, tr.pairs)
	return out
}

// Forget removes a confirmed rename pair (e.g. after it no longer matches status).
func (m *Manager) Forget(projectID, oldPath, newPath string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	tr, ok := m.tracks[projectID]
	if !ok {
		return
	}
	filtered := tr.pairs[:0]
	for _, p := range tr.pairs {
		if p.Old == oldPath && p.New == newPath {
			continue
		}
		filtered = append(filtered, p)
	}
	tr.pairs = filtered
}

// RecordRenameForTest injects a confirmed pair (tests).
func (m *Manager) RecordRenameForTest(projectID, oldPath, newPath string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	tr, ok := m.tracks[projectID]
	if !ok {
		tr = &projectTrack{}
		m.tracks[projectID] = tr
	}
	tr.pairs = append(tr.pairs, RenamePair{Old: oldPath, New: newPath})
}

// NotePendingRemoveForTest / ApplyCreateRelForTest exercise pairing without fsnotify.
func (m *Manager) NotePendingRemoveForTest(projectID, rel string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	tr, ok := m.tracks[projectID]
	if !ok {
		tr = &projectTrack{}
		m.tracks[projectID] = tr
	}
	tr.pending = append(tr.pending, pendingRemove{path: rel, at: time.Now()})
}

func (m *Manager) ApplyCreateRelForTest(projectID, rel string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	tr, ok := m.tracks[projectID]
	if !ok {
		tr = &projectTrack{}
		m.tracks[projectID] = tr
	}
	m.pairCreateLocked(tr, rel, time.Now())
}

func (m *Manager) pairCreateLocked(tr *projectTrack, rel string, now time.Time) {
	m.pruneLocked(tr, now)
	idx := -1
	for i, p := range tr.pending {
		if now.Sub(p.at) <= m.pairTTL {
			idx = i
			break
		}
	}
	if idx < 0 {
		return
	}
	old := tr.pending[idx].path
	tr.pending = append(tr.pending[:idx], tr.pending[idx+1:]...)
	if old == rel {
		return
	}
	filtered := tr.pairs[:0]
	for _, pair := range tr.pairs {
		if pair.Old == old || pair.New == rel || pair.Old == rel || pair.New == old {
			continue
		}
		filtered = append(filtered, pair)
	}
	tr.pairs = append(filtered, RenamePair{Old: old, New: rel})
}

func relPath(root, abs string) (string, bool) {
	if strings.Contains(abs, string(filepath.Separator)+".git"+string(filepath.Separator)) ||
		strings.HasSuffix(abs, string(filepath.Separator)+".git") ||
		filepath.Base(abs) == ".git" {
		return "", false
	}
	// If abs is already relative (tests), accept slash-normalized form.
	if !filepath.IsAbs(abs) && root == "" {
		return filepath.ToSlash(abs), true
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return "", false
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	rel = filepath.ToSlash(rel)
	if rel == "." || strings.HasPrefix(rel, ".git/") || rel == ".git" {
		return "", false
	}
	return rel, true
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
	delete(m.tracks, projectID)
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
	m.tracks = map[string]*projectTrack{}
	for id, t := range m.timers {
		t.Stop()
		delete(m.timers, id)
	}
}
