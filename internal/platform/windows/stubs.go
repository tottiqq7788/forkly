//go:build windows

package windows

import (
	"context"
	"errors"
	"fmt"
	"os/exec"

	"github.com/forkly-app/forkly/internal/platform"
)

// Stub implementations for compile-time Windows support in 0.1.

type FolderPicker struct{}

func (FolderPicker) PickFolder(ctx context.Context, title string) (string, error) {
	return "", errors.New("windows folder picker not implemented in 0.1")
}

type Browser struct{}

func (Browser) OpenURL(url string) error {
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

type Reveal struct{}

func (Reveal) Reveal(path string) error {
	return exec.Command("explorer", "/select,", path).Start()
}

type SingleInstance struct{}

func NewSingleInstance(runtimeDir string) (*SingleInstance, error) {
	return &SingleInstance{}, nil
}

func (s *SingleInstance) Acquire() (bool, error) { return true, nil }
func (s *SingleInstance) Release() error         { return nil }
func (s *SingleInstance) NotifyExisting(message platform.InstanceMessage) error {
	return fmt.Errorf("not implemented")
}
func (s *SingleInstance) Listen(handler func(message platform.InstanceMessage)) {}

type OpenFilesReceiver struct{}

func (OpenFilesReceiver) CollectLaunchOpenFiles() []string { return nil }
func (OpenFilesReceiver) StartOpenFilesWatcher(handler func(paths []string)) {
	_ = handler
}
