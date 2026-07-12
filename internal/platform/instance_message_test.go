package platform_test

import (
	"encoding/json"
	"testing"

	"github.com/forkly-app/forkly/internal/platform"
)

func TestDecodeInstanceMessageLegacyString(t *testing.T) {
	msg, err := platform.DecodeInstanceMessage([]byte(`"open-console"`))
	if err != nil {
		t.Fatal(err)
	}
	if msg.Op != platform.OpOpenConsole {
		t.Fatalf("op=%q", msg.Op)
	}
}

func TestDecodeInstanceMessageOpenFiles(t *testing.T) {
	raw, err := platform.EncodeInstanceMessage(platform.InstanceMessage{
		Op:    platform.OpOpenFiles,
		Paths: []string{"/tmp/a.md", "/tmp/b.md"},
	})
	if err != nil {
		t.Fatal(err)
	}
	msg, err := platform.DecodeInstanceMessage(raw)
	if err != nil {
		t.Fatal(err)
	}
	if msg.Op != platform.OpOpenFiles || len(msg.Paths) != 2 || msg.Paths[0] != "/tmp/a.md" {
		t.Fatalf("%+v", msg)
	}
}

func TestEncodeRoundTripJSONEncoder(t *testing.T) {
	raw, err := json.Marshal(platform.InstanceMessage{Op: platform.OpOpenConsole})
	if err != nil {
		t.Fatal(err)
	}
	msg, err := platform.DecodeInstanceMessage(append(raw, '\n'))
	if err != nil {
		t.Fatal(err)
	}
	if msg.Op != platform.OpOpenConsole {
		t.Fatalf("%+v", msg)
	}
}
