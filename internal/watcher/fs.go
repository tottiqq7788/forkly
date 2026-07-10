package watcher

import "os"

func osStatFile(p string) (os.FileInfo, error) {
	return os.Stat(p)
}
