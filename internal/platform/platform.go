package platform

import "context"

// FolderPicker selects a directory via the native OS dialog.
type FolderPicker interface {
	PickFolder(ctx context.Context, title string) (string, error)
}

// Browser opens a URL in the system default browser.
type Browser interface {
	OpenURL(url string) error
}

// RevealInFinder opens the file manager at path.
type RevealInFinder interface {
	Reveal(path string) error
}

// SingleInstance ensures only one process runs per user session.
type SingleInstance interface {
	Acquire() (acquired bool, err error)
	Release() error
	NotifyExisting(message InstanceMessage) error
	Listen(handler func(message InstanceMessage))
}

// OpenFilesReceiver receives document paths opened via the OS (file association).
type OpenFilesReceiver interface {
	// StartOpenFilesWatcher registers the Go callback and installs the native
	// open-files delegate hook. It must be called before the platform UI event loop.
	StartOpenFilesWatcher(handler func(paths []string)) error
}
