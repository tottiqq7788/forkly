package gitexec

import "testing"

func TestCoalesceObservedRenames(t *testing.T) {
	files := []FileStatus{
		{Path: "old.txt", Kind: StatusDeleted, Unstaged: true},
		{Path: "new.txt", Kind: StatusUntracked, Unstaged: true},
		{Path: "other.txt", Kind: StatusModified, Unstaged: true},
	}

	t.Run("no pairs keeps delete and add", func(t *testing.T) {
		merged, used := CoalesceObservedRenames(files, nil)
		if len(used) != 0 {
			t.Fatalf("used=%v", used)
		}
		if len(merged) != 3 {
			t.Fatalf("len=%d", len(merged))
		}
	})

	t.Run("observed pair merges", func(t *testing.T) {
		merged, used := CoalesceObservedRenames(files, []RenamePair{{Old: "old.txt", New: "new.txt"}})
		if len(used) != 1 {
			t.Fatalf("used=%v", used)
		}
		if len(merged) != 2 {
			t.Fatalf("len=%d %#v", len(merged), merged)
		}
		var renamed *FileStatus
		for i := range merged {
			if merged[i].Kind == StatusRenamed {
				renamed = &merged[i]
			}
		}
		if renamed == nil || renamed.Path != "new.txt" || renamed.OldPath != "old.txt" {
			t.Fatalf("renamed=%#v", renamed)
		}
	})

	t.Run("unrelated pair ignored", func(t *testing.T) {
		merged, used := CoalesceObservedRenames(files, []RenamePair{{Old: "a", New: "b"}})
		if len(used) != 0 || len(merged) != 3 {
			t.Fatalf("used=%v len=%d", used, len(merged))
		}
	})

	t.Run("native renamed untouched", func(t *testing.T) {
		native := []FileStatus{
			{Path: "b.txt", OldPath: "a.txt", Kind: StatusRenamed, Staged: true},
			{Path: "old.txt", Kind: StatusDeleted},
			{Path: "new.txt", Kind: StatusAdded},
		}
		merged, used := CoalesceObservedRenames(native, []RenamePair{{Old: "old.txt", New: "new.txt"}})
		if len(used) != 1 {
			t.Fatalf("used=%v", used)
		}
		if len(merged) != 2 {
			t.Fatalf("len=%d", len(merged))
		}
		if merged[0].Kind != StatusRenamed || merged[0].OldPath != "a.txt" {
			t.Fatalf("native broken: %#v", merged[0])
		}
	})
}
