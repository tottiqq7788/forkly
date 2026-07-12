//go:build darwin

package app

import (
	"github.com/forkly-app/forkly/internal/platform"
	"github.com/forkly-app/forkly/internal/platform/darwin"
)

func newPlatform(runtimeDir string) (
	platform.SingleInstance,
	platform.Browser,
	platform.FolderPicker,
	platform.RevealInFinder,
	platform.OpenFilesReceiver,
	error,
) {
	si, err := darwin.NewSingleInstance(runtimeDir)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	return si, darwin.Browser{}, darwin.FolderPicker{}, darwin.Reveal{}, darwin.OpenFilesReceiver{}, nil
}
