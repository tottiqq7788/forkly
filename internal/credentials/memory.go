package credentials

import "sync"

// MemoryStore is an in-process credential store for tests.
type MemoryStore struct {
	mu   sync.RWMutex
	data map[string]Secret
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{data: map[string]Secret{}}
}

func (m *MemoryStore) Set(accountID string, secret Secret) error {
	encoded, err := encodeSecret(secret)
	if err != nil {
		return err
	}
	decoded, err := decodeSecret(encoded)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[accountID] = decoded
	return nil
}

func (m *MemoryStore) Get(accountID string) (Secret, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.data[accountID]
	if !ok {
		return Secret{}, ErrNotFound
	}
	return s, nil
}

func (m *MemoryStore) Delete(accountID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.data[accountID]; !ok {
		return ErrNotFound
	}
	delete(m.data, accountID)
	return nil
}
