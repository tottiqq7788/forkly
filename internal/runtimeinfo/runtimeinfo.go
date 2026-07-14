package runtimeinfo

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// APIVersion is the stable Local API contract version for CLI negotiation.
const APIVersion = 1

// Info describes a running Forkly Local API instance for CLI discovery.
type Info struct {
	BaseURL    string    `json:"baseUrl"`
	PID        int       `json:"pid"`
	StartedAt  time.Time `json:"startedAt"`
	AppVersion string    `json:"appVersion"`
	APIVersion int       `json:"apiVersion"`
	Nonce      string    `json:"nonce"`
}

func Path(dataDir string) string {
	return filepath.Join(dataDir, "runtime", "api.json")
}

func New(baseURL, appVersion string) (Info, error) {
	baseURL = strings.TrimSpace(baseURL)
	if err := assertLoopbackBaseURL(baseURL); err != nil {
		return Info{}, err
	}
	nonce, err := randomNonce()
	if err != nil {
		return Info{}, err
	}
	return Info{
		BaseURL:    strings.TrimRight(baseURL, "/"),
		PID:        os.Getpid(),
		StartedAt:  time.Now().UTC(),
		AppVersion: appVersion,
		APIVersion: APIVersion,
		Nonce:      nonce,
	}, nil
}

func Write(dataDir string, info Info) error {
	if err := assertLoopbackBaseURL(info.BaseURL); err != nil {
		return err
	}
	dir := filepath.Join(dataDir, "runtime")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}
	path := Path(dataDir)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func Read(dataDir string) (Info, error) {
	raw, err := os.ReadFile(Path(dataDir))
	if err != nil {
		return Info{}, err
	}
	var info Info
	if err := json.Unmarshal(raw, &info); err != nil {
		return Info{}, err
	}
	if err := assertLoopbackBaseURL(info.BaseURL); err != nil {
		return Info{}, err
	}
	if info.APIVersion <= 0 {
		info.APIVersion = 1
	}
	return info, nil
}

// RemoveIfOwner deletes the discovery file only when pid+nonce still match.
func RemoveIfOwner(dataDir string, info Info) error {
	cur, err := Read(dataDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if cur.PID != info.PID || cur.Nonce != info.Nonce {
		return nil
	}
	return os.Remove(Path(dataDir))
}

func assertLoopbackBaseURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return fmt.Errorf("invalid local api url")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("invalid local api scheme")
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	if ip != nil {
		if !ip.IsLoopback() {
			return fmt.Errorf("local api url must be loopback")
		}
		return nil
	}
	switch strings.ToLower(host) {
	case "localhost":
		return nil
	default:
		return fmt.Errorf("local api url must be loopback")
	}
}

func randomNonce() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
