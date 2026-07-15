package cli

import (
	"bytes"
	"strings"
	"testing"

	"github.com/forkly-app/forkly/internal/runtimeinfo"
)

func TestRunHelpAndVersion(t *testing.T) {
	out := &bytes.Buffer{}
	err := &bytes.Buffer{}
	c, e := NewClient(false)
	if e != nil {
		t.Fatal(e)
	}
	c.Out = out
	c.Err = err
	code := Run([]string{"help"}, Options{})
	if code != ExitOK {
		t.Fatalf("help exit %d", code)
	}
	code = Run([]string{"version", "--json"}, Options{JSON: true})
	if code != ExitOK {
		t.Fatalf("version exit %d", code)
	}
}

func TestCapabilitiesListsPresets(t *testing.T) {
	code := Run([]string{"capabilities"}, Options{JSON: true})
	if code != ExitOK {
		t.Fatalf("capabilities exit %d", code)
	}
}

func TestSplitCSVAndFlags(t *testing.T) {
	got := SplitCSV("a, b,,c")
	if len(got) != 3 || got[0] != "a" || got[2] != "c" {
		t.Fatalf("SplitCSV: %#v", got)
	}
	args := []string{"--path", "x.md", "--message", "hi"}
	if flagValue(args, "--path") != "x.md" {
		t.Fatal("flagValue path")
	}
	if flagValue(args, "--message") != "hi" {
		t.Fatal("flagValue message")
	}
	if firstNonFlag([]string{"--x", "y", "z"}) != "y" {
		t.Fatal("firstNonFlag")
	}
}

func TestPrintErrAuthCodes(t *testing.T) {
	c, err := NewClient(true)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	c.Out = &out
	c.Err = &out
	code := c.PrintErr(&APIError{Status: 401, Message: "未登录"})
	if code != ExitAuthRequired {
		t.Fatalf("want auth required, got %d", code)
	}
	if !strings.Contains(out.String(), `"ok": false`) && !strings.Contains(out.String(), `"ok":false`) {
		if !strings.Contains(out.String(), `"ok"`) {
			t.Fatalf("json envelope missing: %s", out.String())
		}
	}
}

func TestAttestHealth(t *testing.T) {
	c, err := NewClient(true)
	if err != nil {
		t.Fatal(err)
	}
	c.DataDir = t.TempDir()
	info := runtimeinfo.Info{BaseURL: "http://127.0.0.1:9", PID: 42, Nonce: "abc"}
	if err := c.attestHealth(info, map[string]any{"pid": float64(42), "nonce": "abc"}); err != nil {
		t.Fatal(err)
	}
	if err := c.attestHealth(info, map[string]any{"pid": float64(1), "nonce": "abc"}); err == nil {
		t.Fatal("expected pid mismatch")
	}
	c.Token = "tok"
	if err := c.SaveTrustedRuntime(info); err != nil {
		t.Fatal(err)
	}
	other := info
	other.Nonce = "zzz"
	if err := c.attestHealth(other, map[string]any{"pid": float64(42), "nonce": "zzz"}); err == nil {
		t.Fatal("expected trust mismatch")
	}
}

func TestEnvelopeJSONSuccess(t *testing.T) {
	c, err := NewClient(true)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	c.Out = &out
	code := c.PrintResult(map[string]any{"hello": "world"})
	if code != ExitOK {
		t.Fatal(code)
	}
	if !strings.Contains(out.String(), `"hello"`) {
		t.Fatalf("unexpected: %s", out.String())
	}
}

func TestIsForklyctlExecutableBase(t *testing.T) {
	if !isForklyctlExecutableBase("forklyctl") {
		t.Fatal("plain name")
	}
	if !isForklyctlExecutableBase("forklyctl.exe") {
		t.Fatal("windows name")
	}
	if isForklyctlExecutableBase("forkly") || isForklyctlExecutableBase("forklyctl.bak") {
		t.Fatal("unexpected match")
	}
}
