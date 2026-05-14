package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// Sentinel errors for typed error handling. Callers can use errors.Is to branch on these.
var (
	// ErrUnknownKeyType is returned when GenerateAPIKey is called with a KeyType that
	// isn't KeyTypeMerchant or KeyTypeAgent. Indicates a programmer error.
	ErrUnknownKeyType = errors.New("unknown key type")

	// ErrInvalidAPIKeyFormat is returned when an API key string doesn't match the expected
	// shape — wrong prefix, wrong overall structure, or wrong length/encoding of any
	// component. Distinct from auth.ErrInvalidAPIKey (defined in keyStore.go), which
	// indicates a well-formed key that didn't match any active DB row.
	ErrInvalidAPIKeyFormat = errors.New("invalid API key format")
)

// KeyType represents the kind of principal a key authenticates.
type KeyType string

const (
	KeyTypeMerchant KeyType = "merchant"
	KeyTypeAgent    KeyType = "agent"
)

// API key format: <prefix><8-char hex keyID>_<32-char hex random>.
//
// Only two prefixes exist. New prefixes must not be added without an explicit
// cross-cutting decision — see backend/CLAUDE.md.
const (
	KeyPrefixMerchants = "sg_merchants_"
	KeyPrefixAgents    = "sg_agents_"

	KeyIDLength     = 8
	KeyRandomLength = 32
)

// GenerateAPIKey generates a new API key with embedded key_id like GitHub.
// Returns the full key and the key_id.
//
// keyType determines the prefix:
//   - KeyTypeMerchant → "sg_merchants_"
//   - KeyTypeAgent    → "sg_agents_"
func GenerateAPIKey(keyType KeyType) (string, string, error) {
	prefix, err := prefixForKeyType(keyType)
	if err != nil {
		return "", "", err
	}

	// Generate 8-char key ID for database lookup (4 bytes -> 8 hex chars)
	keyIDBytes := make([]byte, KeyIDLength/2)
	if _, err := rand.Read(keyIDBytes); err != nil {
		return "", "", fmt.Errorf("failed to generate key ID: %w", err)
	}
	keyID := hex.EncodeToString(keyIDBytes)

	// Generate 32 random bytes for the secret portion
	randomBytes := make([]byte, KeyRandomLength/2)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", "", fmt.Errorf("failed to generate random key: %w", err)
	}
	randomStr := hex.EncodeToString(randomBytes)

	// Construct full key: prefix + keyID + randomStr
	fullKey := prefix + keyID + "_" + randomStr
	return fullKey, keyID, nil
}

// prefixForKeyType returns the prefix string for a given KeyType.
// Returns an error wrapping ErrUnknownKeyType for any unrecognized KeyType.
func prefixForKeyType(t KeyType) (string, error) {
	switch t {
	case KeyTypeMerchant:
		return KeyPrefixMerchants, nil
	case KeyTypeAgent:
		return KeyPrefixAgents, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrUnknownKeyType, t)
	}
}

// detectPrefix returns the matching known prefix and the corresponding KeyType.
// Returns an error wrapping ErrInvalidAPIKeyFormat if the key doesn't start with any
// known prefix.
func detectPrefix(key string) (string, KeyType, error) {
	switch {
	case strings.HasPrefix(key, KeyPrefixAgents):
		return KeyPrefixAgents, KeyTypeAgent, nil
	case strings.HasPrefix(key, KeyPrefixMerchants):
		return KeyPrefixMerchants, KeyTypeMerchant, nil
	default:
		return "", "", fmt.Errorf("%w: must start with %s or %s",
			ErrInvalidAPIKeyFormat, KeyPrefixMerchants, KeyPrefixAgents)
	}
}

// parseAPIKey validates an API key's format and returns its type, matched prefix, and keyID.
// Named returns let early-exit error paths use bare `return` instead of the noisy
// `return "", "", "", err` pattern. On any error, all non-err returns are forced to
// their zero values so callers can rely on the Go convention that `err != nil` implies
// the other returns are unset.
func parseAPIKey(key string) (keyType KeyType, prefix string, keyID string, err error) {
	defer func() {
		if err != nil {
			keyType = ""
			prefix = ""
			keyID = ""
		}
	}()

	if key == "" {
		err = fmt.Errorf("%w: key is empty", ErrInvalidAPIKeyFormat)
		return
	}

	prefix, keyType, err = detectPrefix(key)
	if err != nil {
		// detectPrefix already wraps ErrInvalidAPIKeyFormat; propagate as-is.
		return
	}

	// Body after prefix: keyID_randomPart
	parts := strings.Split(strings.TrimPrefix(key, prefix), "_")
	if len(parts) != 2 {
		err = fmt.Errorf("%w: must have form prefix_keyID_randomPart", ErrInvalidAPIKeyFormat)
		return
	}
	keyIDPart, randomPart := parts[0], parts[1]

	if len(keyIDPart) != KeyIDLength {
		err = fmt.Errorf("%w: key ID must be %d characters", ErrInvalidAPIKeyFormat, KeyIDLength)
		return
	}
	if _, decodeErr := hex.DecodeString(keyIDPart); decodeErr != nil {
		err = fmt.Errorf("%w: key ID must be valid hexadecimal", ErrInvalidAPIKeyFormat)
		return
	}

	if len(randomPart) != KeyRandomLength {
		err = fmt.Errorf("%w: random part must be %d characters", ErrInvalidAPIKeyFormat, KeyRandomLength)
		return
	}
	if _, decodeErr := hex.DecodeString(randomPart); decodeErr != nil {
		err = fmt.Errorf("%w: random part must be valid hexadecimal", ErrInvalidAPIKeyFormat)
		return
	}

	keyID = keyIDPart
	return
}

// ValidateAPIKeyFormat validates an API key's format and returns its KeyType.
// Thin wrapper over parseAPIKey.
func ValidateAPIKeyFormat(key string) (KeyType, error) {
	keyType, _, _, err := parseAPIKey(key)
	return keyType, err
}

// ExtractKeyID extracts the key_id from a full API key for database lookup.
// Accepts the two valid prefixes — KeyPrefixMerchants and KeyPrefixAgents.
// Thin wrapper over parseAPIKey; errors wrap ErrInvalidAPIKeyFormat.
func ExtractKeyID(fullKey string) (string, error) {
	_, _, keyID, err := parseAPIKey(fullKey)
	return keyID, err
}
