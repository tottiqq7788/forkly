//go:build darwin

package darwin

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"

	"github.com/forkly-app/forkly/internal/platform"
)

type SingleInstance struct {
	sockPath string
	ln       net.Listener
	mu       sync.Mutex
	handler  func(platform.InstanceMessage)
}

func NewSingleInstance(runtimeDir string) (*SingleInstance, error) {
	if err := os.MkdirAll(runtimeDir, 0o700); err != nil {
		return nil, err
	}
	return &SingleInstance{sockPath: filepath.Join(runtimeDir, "forkly.sock")}, nil
}

func (s *SingleInstance) Acquire() (bool, error) {
	if err := os.Remove(s.sockPath); err != nil && !os.IsNotExist(err) {
		conn, err2 := net.Dial("unix", s.sockPath)
		if err2 == nil {
			_ = conn.Close()
			return false, nil
		}
		_ = os.Remove(s.sockPath)
	}
	ln, err := net.Listen("unix", s.sockPath)
	if err != nil {
		return false, nil
	}
	_ = os.Chmod(s.sockPath, 0o600)
	s.ln = ln
	go s.acceptLoop()
	return true, nil
}

func (s *SingleInstance) acceptLoop() {
	for {
		conn, err := s.ln.Accept()
		if err != nil {
			return
		}
		go func(c net.Conn) {
			defer c.Close()
			raw, err := io.ReadAll(io.LimitReader(c, 1<<20))
			if err != nil || len(raw) == 0 {
				return
			}
			msg, err := platform.DecodeInstanceMessage(raw)
			if err != nil {
				return
			}
			s.mu.Lock()
			h := s.handler
			s.mu.Unlock()
			if h != nil {
				h(msg)
			}
		}(conn)
	}
}

func (s *SingleInstance) Release() error {
	if s.ln != nil {
		_ = s.ln.Close()
	}
	return os.Remove(s.sockPath)
}

func (s *SingleInstance) NotifyExisting(message platform.InstanceMessage) error {
	conn, err := net.Dial("unix", s.sockPath)
	if err != nil {
		return fmt.Errorf("notify existing: %w", err)
	}
	defer conn.Close()
	enc := json.NewEncoder(conn)
	return enc.Encode(message)
}

func (s *SingleInstance) Listen(handler func(message platform.InstanceMessage)) {
	s.mu.Lock()
	s.handler = handler
	s.mu.Unlock()
}
