package watcher

import "testing"

func TestRenamePairingFIFO(t *testing.T) {
	m := New(nil)
	id := "p1"
	m.NotePendingRemoveForTest(id, "a.txt")
	m.ApplyCreateRelForTest(id, "b.txt")
	pairs := m.ObservedRenames(id)
	if len(pairs) != 1 || pairs[0].Old != "a.txt" || pairs[0].New != "b.txt" {
		t.Fatalf("pairs=%v", pairs)
	}

	m.NotePendingRemoveForTest(id, "c.txt")
	m.NotePendingRemoveForTest(id, "d.txt")
	m.ApplyCreateRelForTest(id, "e.txt")
	m.ApplyCreateRelForTest(id, "f.txt")
	pairs = m.ObservedRenames(id)
	if len(pairs) != 3 {
		t.Fatalf("want 3 pairs, got %v", pairs)
	}
	if pairs[1].Old != "c.txt" || pairs[1].New != "e.txt" {
		t.Fatalf("fifo1=%v", pairs[1])
	}
	if pairs[2].Old != "d.txt" || pairs[2].New != "f.txt" {
		t.Fatalf("fifo2=%v", pairs[2])
	}
}

func TestForgetRename(t *testing.T) {
	m := New(nil)
	m.RecordRenameForTest("p", "old", "new")
	m.Forget("p", "old", "new")
	if len(m.ObservedRenames("p")) != 0 {
		t.Fatal("expected empty")
	}
}

func TestCreateWithoutPendingIgnored(t *testing.T) {
	m := New(nil)
	m.ApplyCreateRelForTest("p", "only-new.txt")
	if len(m.ObservedRenames("p")) != 0 {
		t.Fatal("should not pair")
	}
}
