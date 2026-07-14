package operation

import (
	"testing"
	"time"
)

func TestManagerLifecycle(t *testing.T) {
	m := NewManager()
	op, ctx, err := m.Start("fetch", "p1", "/tmp/repo")
	if err != nil {
		t.Fatal(err)
	}
	if op.Status != StatusRunning {
		t.Fatalf("%+v", op)
	}
	_, _, err = m.Start("push", "p1", "/tmp/repo")
	if err == nil {
		t.Fatal("expected busy")
	}
	m.Update(op.ID, "fetching", 0.5, "…")
	got, ok := m.Get(op.ID)
	if !ok || got.Phase != "fetching" {
		t.Fatalf("%+v", got)
	}
	m.Succeed(op.ID, "ok")
	got, _ = m.Get(op.ID)
	if got.Status != StatusSucceeded {
		t.Fatalf("%+v", got)
	}
	select {
	case <-ctx.Done():
		// cancel may not fire on succeed; that's fine
	default:
	}
	// slot freed
	op2, _, err := m.Start("push", "p1", "/tmp/repo")
	if err != nil {
		t.Fatal(err)
	}
	m.Cancel(op2.ID)
	time.Sleep(10 * time.Millisecond)
	got, _ = m.Get(op2.ID)
	if got.Status != StatusCanceled {
		t.Fatalf("%+v", got)
	}
}
