package credentials

import (
	"errors"
	"fmt"

	"github.com/zalando/go-keyring"
)

// KeychainStore stores secrets in the OS credential manager.
type KeychainStore struct {
	service string
}

func NewKeychainStore() *KeychainStore {
	return &KeychainStore{service: ServiceName}
}

func (k *KeychainStore) Set(accountID string, secret Secret) error {
	if accountID == "" {
		return fmt.Errorf("account id required")
	}
	raw, err := encodeSecret(secret)
	if err != nil {
		return err
	}
	if err := keyring.Set(k.service, accountID, raw); err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return nil
}

func (k *KeychainStore) Get(accountID string) (Secret, error) {
	if accountID == "" {
		return Secret{}, fmt.Errorf("account id required")
	}
	raw, err := keyring.Get(k.service, accountID)
	if err != nil {
		if errors.Is(err, keyring.ErrNotFound) {
			return Secret{}, ErrNotFound
		}
		return Secret{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return decodeSecret(raw)
}

func (k *KeychainStore) Delete(accountID string) error {
	if accountID == "" {
		return fmt.Errorf("account id required")
	}
	err := keyring.Delete(k.service, accountID)
	if err != nil {
		if errors.Is(err, keyring.ErrNotFound) {
			return ErrNotFound
		}
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return nil
}
