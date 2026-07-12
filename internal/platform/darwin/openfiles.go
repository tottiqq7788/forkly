//go:build darwin

package darwin

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework AppKit

#include <stdlib.h>
#include <stdbool.h>

const char* forklyInstallOpenFilesDelegateHook(void);
bool forklySystrayRespondsToOpenFiles(void);
void forklyInvokeOpenFilesForTest(char **paths, int count);
*/
import "C"
import (
	"fmt"
	"sync"
	"unsafe"

	_ "fyne.io/systray" // ensure SystrayAppDelegate is linked for the runtime hook
)

type OpenFilesReceiver struct{}

var (
	openFilesMu      sync.Mutex
	openFilesHandler func(paths []string)
	openFilesPending [][]string
)

//export forklyOpenFilesBridge
func forklyOpenFilesBridge(paths **C.char, count C.int) {
	if paths == nil || count <= 0 {
		return
	}
	out := make([]string, 0, int(count))
	slice := unsafe.Slice(paths, int(count))
	for i := 0; i < int(count); i++ {
		if slice[i] == nil {
			continue
		}
		out = append(out, C.GoString(slice[i]))
	}
	if len(out) == 0 {
		return
	}
	openFilesMu.Lock()
	h := openFilesHandler
	if h == nil {
		openFilesPending = append(openFilesPending, out)
		openFilesMu.Unlock()
		return
	}
	openFilesMu.Unlock()
	h(out)
}

// InstallOpenFilesDelegateHook adds application:openFile(s): onto SystrayAppDelegate
// so AppKit routes Finder Open Documents events through our Go bridge.
func InstallOpenFilesDelegateHook() error {
	msg := C.forklyInstallOpenFilesDelegateHook()
	if msg != nil {
		return fmt.Errorf("%s", C.GoString(msg))
	}
	return nil
}

func systrayRespondsToOpenFiles() bool {
	return bool(C.forklySystrayRespondsToOpenFiles())
}

func invokeOpenFilesForTest(paths []string) {
	if len(paths) == 0 {
		return
	}
	cPaths := make([]*C.char, len(paths))
	for i, p := range paths {
		cPaths[i] = C.CString(p)
	}
	defer func() {
		for _, p := range cPaths {
			C.free(unsafe.Pointer(p))
		}
	}()
	C.forklyInvokeOpenFilesForTest(&cPaths[0], C.int(len(cPaths)))
}

func (OpenFilesReceiver) StartOpenFilesWatcher(handler func(paths []string)) error {
	openFilesMu.Lock()
	openFilesHandler = handler
	pending := openFilesPending
	openFilesPending = nil
	openFilesMu.Unlock()

	if err := InstallOpenFilesDelegateHook(); err != nil {
		return err
	}

	for _, paths := range pending {
		if handler != nil && len(paths) > 0 {
			handler(paths)
		}
	}
	return nil
}
