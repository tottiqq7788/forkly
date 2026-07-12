//go:build darwin

package darwin

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework AppKit

#include <stdlib.h>

char** forklyCollectLaunchOpenFiles(int* outCount);
void forklyFreeStringArray(char** paths, int count);
void forklyStartOpenFilesWatcher(void);
*/
import "C"
import (
	"sync"
	"unsafe"
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

func (OpenFilesReceiver) CollectLaunchOpenFiles() []string {
	var n C.int
	cPaths := C.forklyCollectLaunchOpenFiles(&n)
	if cPaths == nil || n <= 0 {
		return nil
	}
	defer C.forklyFreeStringArray(cPaths, n)
	out := make([]string, 0, int(n))
	slice := unsafe.Slice(cPaths, int(n))
	for i := 0; i < int(n); i++ {
		if slice[i] == nil {
			continue
		}
		out = append(out, C.GoString(slice[i]))
	}
	return out
}

func (OpenFilesReceiver) StartOpenFilesWatcher(handler func(paths []string)) {
	openFilesMu.Lock()
	openFilesHandler = handler
	pending := openFilesPending
	openFilesPending = nil
	openFilesMu.Unlock()
	C.forklyStartOpenFilesWatcher()
	for _, paths := range pending {
		if handler != nil && len(paths) > 0 {
			handler(paths)
		}
	}
}
