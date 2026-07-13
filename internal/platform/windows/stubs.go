//go:build windows

package windows

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"

	"github.com/forkly-app/forkly/internal/platform"
	xwindows "golang.org/x/sys/windows"
)

const defaultInstanceAddr = "127.0.0.1:57531"

type FolderPicker struct{}

func (FolderPicker) PickFolder(ctx context.Context, title string) (string, error) {
	if title == "" {
		title = "选择项目文件夹"
	}
	script := `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $env:FORKLY_PICKER_TITLE
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
  exit 0
}
exit 2
`
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.Env = append(os.Environ(), "FORKLY_PICKER_TITLE="+title)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	path := string(bytes.TrimSpace(out))
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) && ee.ExitCode() == 2 {
			return "", errors.New("cancelled")
		}
		return "", fmt.Errorf("打开文件夹选择器失败: %w", err)
	}
	if path == "" {
		return "", errors.New("cancelled")
	}
	return path, nil
}

type Browser struct{}

func (Browser) OpenURL(url string) error {
	if os.Getenv("FORKLY_SKIP_BROWSER") == "1" {
		return nil
	}
	return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
}

type Reveal struct{}

func (Reveal) Reveal(path string) error {
	path = filepath.Clean(path)
	if path == "." || path == "" {
		return errors.New("路径无效")
	}
	return exec.Command("explorer.exe", "/select,"+path).Start()
}

type SingleInstance struct {
	addr    string
	mutex   xwindows.Handle
	ln      net.Listener
	mu      sync.Mutex
	handler func(platform.InstanceMessage)
	pending []platform.InstanceMessage
}

func NewSingleInstance(runtimeDir string) (*SingleInstance, error) {
	addr := os.Getenv("FORKLY_INSTANCE_ADDR")
	if addr == "" {
		addr = defaultInstanceAddr
	}
	_ = runtimeDir // kept for parity with other platform constructors
	return &SingleInstance{addr: addr}, nil
}

func (s *SingleInstance) Acquire() (bool, error) {
	name, err := xwindows.UTF16PtrFromString(`Local\ForklySingleInstance`)
	if err != nil {
		return false, err
	}
	mutex, err := xwindows.CreateMutex(nil, true, name)
	if err == xwindows.ERROR_ALREADY_EXISTS {
		_ = xwindows.CloseHandle(mutex)
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("create single-instance mutex: %w", err)
	}

	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		_ = xwindows.ReleaseMutex(mutex)
		_ = xwindows.CloseHandle(mutex)
		return false, fmt.Errorf("listen single-instance ipc: %w", err)
	}
	s.mutex = mutex
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
			if h == nil {
				s.pending = append(s.pending, msg)
				s.mu.Unlock()
				return
			}
			s.mu.Unlock()
			h(msg)
		}(conn)
	}
}

func (s *SingleInstance) Release() error {
	if s.ln != nil {
		_ = s.ln.Close()
	}
	if s.mutex != 0 {
		_ = xwindows.ReleaseMutex(s.mutex)
		_ = xwindows.CloseHandle(s.mutex)
		s.mutex = 0
	}
	return nil
}

func (s *SingleInstance) NotifyExisting(message platform.InstanceMessage) error {
	conn, err := net.Dial("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("notify existing: %w", err)
	}
	defer conn.Close()
	raw, err := platform.EncodeInstanceMessage(message)
	if err != nil {
		return err
	}
	_, err = conn.Write(raw)
	return err
}

func (s *SingleInstance) Listen(handler func(message platform.InstanceMessage)) {
	s.mu.Lock()
	s.handler = handler
	pending := s.pending
	s.pending = nil
	s.mu.Unlock()
	for _, msg := range pending {
		if handler != nil {
			handler(msg)
		}
	}
}

type OpenFilesReceiver struct{}

func (OpenFilesReceiver) StartOpenFilesWatcher(handler func(paths []string)) error {
	_ = handler
	// Windows document launches pass paths as argv. If Forkly is already running,
	// the second process forwards those paths through SingleInstance.NotifyExisting.
	return nil
}
