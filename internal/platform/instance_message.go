package platform

import "encoding/json"

// Instance message ops forwarded between single-instance processes.
const (
	OpOpenConsole = "open-console"
	OpOpenFiles   = "open-files"
)

// InstanceMessage is the structured payload sent over the single-instance socket.
// Legacy clients may still send a bare JSON string ("open-console").
type InstanceMessage struct {
	Op    string   `json:"op"`
	Paths []string `json:"paths,omitempty"`
}

func EncodeInstanceMessage(msg InstanceMessage) ([]byte, error) {
	if msg.Op == "" {
		msg.Op = OpOpenConsole
	}
	return json.Marshal(msg)
}

// DecodeInstanceMessage accepts either a structured object or a legacy string.
func DecodeInstanceMessage(data []byte) (InstanceMessage, error) {
	data = trimSpaceBytes(data)
	if len(data) == 0 {
		return InstanceMessage{Op: OpOpenConsole}, nil
	}
	if data[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return InstanceMessage{}, err
		}
		if s == "" {
			s = OpOpenConsole
		}
		return InstanceMessage{Op: s}, nil
	}
	var msg InstanceMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return InstanceMessage{}, err
	}
	if msg.Op == "" {
		msg.Op = OpOpenConsole
	}
	return msg, nil
}

func trimSpaceBytes(b []byte) []byte {
	i, j := 0, len(b)
	for i < j && (b[i] == ' ' || b[i] == '\n' || b[i] == '\r' || b[i] == '\t') {
		i++
	}
	for j > i && (b[j-1] == ' ' || b[j-1] == '\n' || b[j-1] == '\r' || b[j-1] == '\t') {
		j--
	}
	return b[i:j]
}
