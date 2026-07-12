//go:build darwin

package darwin

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework AppKit
#import <Cocoa/Cocoa.h>
#import <stdlib.h>

static char* pickFolder(const char* titleC) {
    __block char* result = NULL;
    dispatch_sync(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            NSOpenPanel* panel = [NSOpenPanel openPanel];
            panel.canChooseFiles = NO;
            panel.canChooseDirectories = YES;
            panel.allowsMultipleSelection = NO;
            panel.canCreateDirectories = YES;
            if (titleC != NULL) {
                panel.message = [NSString stringWithUTF8String:titleC];
            }
            if ([panel runModal] == NSModalResponseOK) {
                NSURL* url = panel.URL;
                if (url != nil) {
                    const char* path = url.path.fileSystemRepresentation;
                    if (path != NULL) {
                        result = strdup(path);
                    }
                }
            }
        }
    });
    return result;
}

static void openURL(const char* urlC) {
    @autoreleasepool {
        NSString* s = [NSString stringWithUTF8String:urlC];
        NSURL* url = [NSURL URLWithString:s];
        if (url != nil) {
            [[NSWorkspace sharedWorkspace] openURL:url];
        }
    }
}

static void revealPath(const char* pathC) {
    @autoreleasepool {
        NSString* s = [NSString stringWithUTF8String:pathC];
        [[NSWorkspace sharedWorkspace] selectFile:s inFileViewerRootedAtPath:@""];
    }
}
*/
import "C"
import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"unsafe"
)

type FolderPicker struct{}

func (FolderPicker) PickFolder(ctx context.Context, title string) (string, error) {
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	default:
	}
	var cTitle *C.char
	if title != "" {
		cTitle = C.CString(title)
		defer C.free(unsafe.Pointer(cTitle))
	}
	res := C.pickFolder(cTitle)
	if res == nil {
		return "", errors.New("cancelled")
	}
	defer C.free(unsafe.Pointer(res))
	return C.GoString(res), nil
}

type Browser struct{}

func (Browser) OpenURL(url string) error {
	// Always record the last open URL for local diagnostics (claim tokens are one-time).
	if home, err := os.UserHomeDir(); err == nil {
		dir := filepath.Join(home, "Library", "Logs", "Forkly")
		_ = os.MkdirAll(dir, 0o700)
		_ = os.WriteFile(filepath.Join(dir, "last-open-url.txt"), []byte(url), 0o600)
	}
	if os.Getenv("FORKLY_SKIP_BROWSER") == "1" {
		return nil
	}
	c := C.CString(url)
	defer C.free(unsafe.Pointer(c))
	C.openURL(c)
	return nil
}

type Reveal struct{}

func (Reveal) Reveal(path string) error {
	c := C.CString(path)
	defer C.free(unsafe.Pointer(c))
	C.revealPath(c)
	return nil
}
