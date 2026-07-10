//go:build windows

package app

import (
	"github.com/forkly-app/forkly/internal/platform"
	"github.com/forkly-app/forkly/internal/platform/windows"
)

func newPlatform(runtimeDir string) (platform.SingleInstance, platform.Browser, platform.FolderPicker, platform.RevealInFinder, error) {
	si, err := windows.NewSingleInstance(runtimeDir)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	return si, windows.Browser{}, windows.FolderPicker{}, windows.Reveal{}, nil
}
