package auth

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
)

const (
	// API key format: sg_live_8charKeyID_32randomchars
	KeyPrefixLive   = "sg_live_"
	KeyIDLength     = 8
	KeyRandomLength = 32
)

// GenerateAPIKey generates a new API key with embedded key_id like GitHub.
// Returns the full key and key_id.
func GenerateAPIKey() (string, string, error) {
	// Generate 8-char key ID for database lookup (4 bytes -> 8 hex chars)
	keyIDBytes := make([]byte, KeyIDLength/2)
	_, err := rand.Read(keyIDBytes)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate key ID: %w", err)
	}
	keyID := hex.EncodeToString(keyIDBytes)

	// Generate 32 random bytes for the secret portion
	randomBytes := make([]byte, KeyRandomLength/2)
	_, err = rand.Read(randomBytes)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate random key: %w", err)
	}
	randomStr := hex.EncodeToString(randomBytes)

	// Construct full key: prefix + keyID + randomStr
	fullKey := KeyPrefixLive + keyID + "_" + randomStr

	return fullKey, keyID, nil
}

// ValidateAPIKeyFormat validates that an API key follows the expected format.
func ValidateAPIKeyFormat(key string) error {
	if key == "" {
		return fmt.Errorf("API key cannot be empty")
	}

	// Check if it starts with valid prefix
	if !strings.HasPrefix(key, KeyPrefixLive) {
		return fmt.Errorf("API key must start with %s", KeyPrefixLive)
	}

	// Extract the portion after prefix
	afterPrefix := strings.TrimPrefix(key, KeyPrefixLive)

	// Split by underscore: keyID_randomPart
	parts := strings.Split(afterPrefix, "_")
	if len(parts) != 2 {
		return fmt.Errorf("API key must have format: prefix_keyID_randomPart")
	}

	keyIDPart := parts[0]
	randomPart := parts[1]

	// Check key ID length
	if len(keyIDPart) != KeyIDLength {
		return fmt.Errorf("API key ID must be %d characters", KeyIDLength)
	}

	// Check that key ID is valid hex
	_, err := hex.DecodeString(keyIDPart)
	if err != nil {
		return fmt.Errorf("API key ID must be valid hexadecimal")
	}

	// Check random part length
	if len(randomPart) != KeyRandomLength {
		return fmt.Errorf("API key random part must be %d characters", KeyRandomLength)
	}

	// Check that random part is valid hex
	_, err = hex.DecodeString(randomPart)
	if err != nil {
		return fmt.Errorf("API key random part must be valid hexadecimal")
	}

	return nil
}

// ExtractKeyID extracts the key_id from a full API key for database lookup.
func ExtractKeyID(fullKey string) (string, error) {
	if err := ValidateAPIKeyFormat(fullKey); err != nil {
		return "", fmt.Errorf("invalid API key format: %w", err)
	}

	parts := strings.Split(strings.TrimPrefix(fullKey, KeyPrefixLive), "_")
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid key format")
	}
	keyID := parts[0]

	if len(keyID) != KeyIDLength {
		return "", fmt.Errorf("invalid key ID length: expected %d, got %d", KeyIDLength, len(keyID))
	}

	return keyID, nil
}

