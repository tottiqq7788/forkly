//go:build darwin

package darwin

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
)

type SingleInstance struct {
	sockPath string
	ln       net.Listener
	mu       sync.Mutex
	handler  func(string)
}

func NewSingleInstance(runtimeDir string) (*SingleInstance, error) {
	if err := os.MkdirAll(runtimeDir, 0o700); err != nil {
		return nil, err
	}
	return &SingleInstance{sockPath: filepath.Join(runtimeDir, "forkly.sock")}, nil
}

func (s *SingleInstance) Acquire() (bool, error) {
	if err := os.Remove(s.sockPath); err != nil && !os.IsNotExist(err) {
		// try connect to existing
		conn, err2 := net.Dial("unix", s.sockPath)
		if err2 == nil {
			_ = conn.Close()
			return false, nil
		}
		_ = os.Remove(s.sockPath)
	}
	ln, err := net.Listen("unix", s.sockPath)
	if err != nil {
		// another instance holds it
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
			var msg string
			dec := json.NewDecoder(c)
			if err := dec.Decode(&msg); err == nil {
				s.mu.Lock()
				h := s.handler
				s.mu.Unlock()
				if h != nil {
					h(msg)
				}
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

func (s *SingleInstance) NotifyExisting(message string) error {
	conn, err := net.Dial("unix", s.sockPath)
	if err != nil {
		return fmt.Errorf("notify existing: %w", err)
	}
	defer conn.Close()
	return json.NewEncoder(conn).Encode(message)
}

func (s *SingleInstance) Listen(handler func(message string)) {
	s.mu.Lock()
	s.handler = handler
	s.mu.Unlock()
}
