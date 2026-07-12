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

// OpenFilesReceiver collects document paths opened via the OS (file association).
type OpenFilesReceiver interface {
	// CollectLaunchOpenFiles returns paths from the launch Open Documents event, if any.
	CollectLaunchOpenFiles() []string
	// StartOpenFilesWatcher registers for subsequent Open Documents events.
	StartOpenFilesWatcher(handler func(paths []string))
}
