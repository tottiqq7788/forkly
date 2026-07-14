package operation

import (
	"context"
	"sync"
	"time"

	"github.com/forkly-app/forkly/internal/session"
)

type Status string

const (
	StatusQueued    Status = "queued"
	StatusRunning   Status = "running"
	StatusSucceeded Status = "succeeded"
	StatusFailed    Status = "failed"
	StatusCanceled  Status = "canceled"
)

type Op struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	ProjectID string    `json:"projectId,omitempty"`
	RepoPath  string    `json:"-"`
	Status    Status    `json:"status"`
	Phase     string    `json:"phase,omitempty"`
	Progress  float64   `json:"progress,omitempty"`
	Message   string    `json:"message,omitempty"`
	Error     string    `json:"error,omitempty"`
	ErrorCode string    `json:"errorCode,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	cancel context.CancelFunc
}

type Manager struct {
	mu      sync.Mutex
	ops     map[string]*Op
	repoBusy map[string]string // repo path -> op id
	ttl     time.Duration
}

func NewManager() *Manager {
	m := &Manager{
		ops:      map[string]*Op{},
		repoBusy: map[string]string{},
		ttl:      15 * time.Minute,
	}
	go m.reaper()
	return m
}

func (m *Manager) reaper() {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for range t.C {
		m.mu.Lock()
		now := time.Now()
		for id, op := range m.ops {
			if op.Status == StatusRunning || op.Status == StatusQueued {
				continue
			}
			if now.Sub(op.UpdatedAt) > m.ttl {
				delete(m.ops, id)
			}
		}
		m.mu.Unlock()
	}
}

// Start reserves a per-repo slot and returns a cancellable context.
func (m *Manager) Start(kind, projectID, repoPath string) (*Op, context.Context, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if repoPath != "" {
		if existing, ok := m.repoBusy[repoPath]; ok {
			return nil, nil, &BusyError{OpID: existing}
		}
	}
	id := session.RandomURLSafe(12)
	ctx, cancel := context.WithCancel(context.Background())
	now := time.Now()
	op := &Op{
		ID:        id,
		Kind:      kind,
		ProjectID: projectID,
		RepoPath:  repoPath,
		Status:    StatusRunning,
		Phase:     "starting",
		CreatedAt: now,
		UpdatedAt: now,
		cancel:    cancel,
	}
	m.ops[id] = op
	if repoPath != "" {
		m.repoBusy[repoPath] = id
	}
	return op, ctx, nil
}

type BusyError struct{ OpID string }

func (e *BusyError) Error() string { return "已有远端操作进行中" }

func (m *Manager) Update(id, phase string, progress float64, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	op, ok := m.ops[id]
	if !ok {
		return
	}
	op.Phase = phase
	op.Progress = progress
	if message != "" {
		op.Message = message
	}
	op.UpdatedAt = time.Now()
}

func (m *Manager) Succeed(id, message string) {
	m.finish(id, StatusSucceeded, message, "", "")
}

func (m *Manager) Fail(id, message, code string) {
	m.finish(id, StatusFailed, message, message, code)
}

func (m *Manager) Cancel(id string) bool {
	m.mu.Lock()
	op, ok := m.ops[id]
	if !ok {
		m.mu.Unlock()
		return false
	}
	cancel := op.cancel
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	m.finish(id, StatusCanceled, "已取消", "已取消", "canceled")
	return true
}

func (m *Manager) finish(id string, status Status, message, errMsg, code string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	op, ok := m.ops[id]
	if !ok {
		return
	}
	if op.Status == StatusSucceeded || op.Status == StatusFailed || op.Status == StatusCanceled {
		return
	}
	op.Status = status
	op.Message = message
	op.Error = errMsg
	op.ErrorCode = code
	op.UpdatedAt = time.Now()
	op.Progress = 1
	if op.RepoPath != "" && m.repoBusy[op.RepoPath] == id {
		delete(m.repoBusy, op.RepoPath)
	}
}

func (m *Manager) Get(id string) (*Op, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	op, ok := m.ops[id]
	if !ok {
		return nil, false
	}
	cp := *op
	return &cp, true
}

func (m *Manager) ActiveForProject(projectID string) *Op {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, op := range m.ops {
		if op.ProjectID == projectID && (op.Status == StatusRunning || op.Status == StatusQueued) {
			cp := *op
			return &cp
		}
	}
	return nil
}

func (m *Manager) CancelAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.ops))
	cancels := []context.CancelFunc{}
	for id, op := range m.ops {
		if op.Status == StatusRunning || op.Status == StatusQueued {
			ids = append(ids, id)
			if op.cancel != nil {
				cancels = append(cancels, op.cancel)
			}
		}
	}
	m.mu.Unlock()
	for _, c := range cancels {
		c()
	}
	for _, id := range ids {
		m.finish(id, StatusCanceled, "应用关闭", "应用关闭", "canceled")
	}
}
