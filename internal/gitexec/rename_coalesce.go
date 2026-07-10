package gitexec

// RenamePair is an observed filesystem rename (relative paths, slash-separated).
type RenamePair struct {
	Old string
	New string
}

// CoalesceObservedRenames merges deleted+added/untracked pairs into renamed
// when an observed FS rename matches. Unmatched delete/add stay separate.
// Native Git renames (already Kind=renamed) are left unchanged.
// Fingerprint should be computed from the raw files before calling this.
func CoalesceObservedRenames(files []FileStatus, pairs []RenamePair) (merged []FileStatus, used []RenamePair) {
	if len(files) == 0 || len(pairs) == 0 {
		return files, nil
	}

	byPath := make(map[string]int, len(files))
	for i, f := range files {
		byPath[f.Path] = i
	}

	skip := make(map[int]bool)
	used = make([]RenamePair, 0)

	for _, pair := range pairs {
		if pair.Old == "" || pair.New == "" || pair.Old == pair.New {
			continue
		}
		oi, okOld := byPath[pair.Old]
		ni, okNew := byPath[pair.New]
		if !okOld || !okNew || skip[oi] || skip[ni] {
			continue
		}
		oldF := files[oi]
		newF := files[ni]
		if oldF.Kind != StatusDeleted {
			continue
		}
		if newF.Kind != StatusUntracked && newF.Kind != StatusAdded {
			continue
		}
		skip[oi] = true
		skip[ni] = true
		used = append(used, pair)
	}

	if len(used) == 0 {
		return files, nil
	}

	usedByNew := make(map[string]RenamePair, len(used))
	for _, p := range used {
		usedByNew[p.New] = p
	}

	merged = make([]FileStatus, 0, len(files)-len(used))
	for i, f := range files {
		if skip[i] {
			if p, ok := usedByNew[f.Path]; ok {
				merged = append(merged, FileStatus{
					Path:     p.New,
					OldPath:  p.Old,
					Kind:     StatusRenamed,
					Staged:   f.Staged,
					Unstaged: true,
				})
			}
			continue
		}
		merged = append(merged, f)
	}
	return merged, used
}
