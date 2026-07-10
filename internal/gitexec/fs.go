package gitexec

import "os"

func osStatImpl(p string) (os.FileInfo, error) {
	return os.Stat(p)
}
