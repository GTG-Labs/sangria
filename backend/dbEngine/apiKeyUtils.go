package dbengine

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

const (
	// API key format: sg_live_32randomchars or sg_test_32randomchars
	KeyPrefixLive = "sg_live_"
	KeyPrefixTest = "sg_test_"
	KeyRandomLength = 32
)

// GenerateAPIKey generates a new API key with the specified environment
// Returns the full key and a display identifier (first 8 chars for identification)
func GenerateAPIKey(isLive bool) (string, string, error) {
	// Generate 32 random bytes
	randomBytes := make([]byte, KeyRandomLength/2) // hex encoding doubles the length
	_, err := rand.Read(randomBytes)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate random key: %w", err)
	}

	// Convert to hex string
	randomStr := hex.EncodeToString(randomBytes)

	// Choose prefix based on environment
	var prefix string
	if isLive {
		prefix = KeyPrefixLive
	} else {
		prefix = KeyPrefixTest
	}

	// Construct full key
	fullKey := prefix + randomStr

	// Create display identifier (prefix + first 8 chars for identification only)
	displayId := prefix + randomStr[:8]

	return fullKey, displayId, nil
}

// HashAPIKey hashes an API key using bcrypt for secure storage
func HashAPIKey(key string) (string, error) {
	// Use bcrypt with cost 12 for good security/performance balance
	hash, err := bcrypt.GenerateFromPassword([]byte(key), 12)
	if err != nil {
		return "", fmt.Errorf("failed to hash API key: %w", err)
	}
	return string(hash), nil
}

// VerifyAPIKey verifies an API key against its stored hash
func VerifyAPIKey(key, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(key))
	return err == nil
}

// ValidateAPIKeyFormat validates that an API key follows the expected format
func ValidateAPIKeyFormat(key string) error {
	if key == "" {
		return fmt.Errorf("API key cannot be empty")
	}

	// Check if it starts with valid prefix
	if !strings.HasPrefix(key, KeyPrefixLive) && !strings.HasPrefix(key, KeyPrefixTest) {
		return fmt.Errorf("API key must start with %s or %s", KeyPrefixLive, KeyPrefixTest)
	}

	// Extract the random portion
	var randomPart string
	if strings.HasPrefix(key, KeyPrefixLive) {
		randomPart = strings.TrimPrefix(key, KeyPrefixLive)
	} else {
		randomPart = strings.TrimPrefix(key, KeyPrefixTest)
	}

	// Check random part length
	if len(randomPart) != KeyRandomLength {
		return fmt.Errorf("API key random part must be %d characters", KeyRandomLength)
	}

	// Check that random part is valid hex
	_, err := hex.DecodeString(randomPart)
	if err != nil {
		return fmt.Errorf("API key random part must be valid hexadecimal")
	}

	return nil
}

// IsLiveKey returns true if the API key is a live/production key
func IsLiveKey(key string) bool {
	return strings.HasPrefix(key, KeyPrefixLive)
}

// GetKeyPrefix extracts the display prefix from a full API key
func GetKeyPrefix(key string) string {
	if err := ValidateAPIKeyFormat(key); err != nil {
		return ""
	}

	var prefix string
	var randomPart string

	if strings.HasPrefix(key, KeyPrefixLive) {
		prefix = KeyPrefixLive
		randomPart = strings.TrimPrefix(key, KeyPrefixLive)
	} else {
		prefix = KeyPrefixTest
		randomPart = strings.TrimPrefix(key, KeyPrefixTest)
	}

	// Return first 8 chars of random part with ellipsis
	if len(randomPart) >= 8 {
		return prefix + randomPart[:8] + "..."
	}

	return prefix + randomPart + "..."
}

// SecureCompare performs constant-time comparison of API key hashes
// to prevent timing attacks
func SecureCompare(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}