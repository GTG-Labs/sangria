package auth

import "golang.org/x/crypto/bcrypt"

// HashAPIKey hashes an API key using bcrypt for secure storage.
func HashAPIKey(key string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(key), 12)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyAPIKey verifies an API key against its stored hash.
func VerifyAPIKey(key, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(key))
	return err == nil
}

