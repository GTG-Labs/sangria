package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	dbengine "sangria/backend/dbEngine"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// ErrAPIKeyNotFound is returned when an API key does not exist or is not owned by the user.
var ErrAPIKeyNotFound = errors.New("API key not found or not owned by user")

// ErrInvalidAPIKey is returned when AuthenticateAPIKey cannot match the
// provided key to any active merchant (no key_id match, or key_id matched
// but the hash comparison failed). Callers should use errors.Is to detect.
var ErrInvalidAPIKey = errors.New("invalid API key")

// precomputed bcrypt dummy hash
var dummyHash []byte

func init() {
	// The plaintext we hash doesn't matter — this hash is only ever compared
	// against an attacker-supplied key that won't match. The goal is purely
	// to force bcrypt to run so response time is constant on a no-match.
	h, err := bcrypt.GenerateFromPassword([]byte("dummy"), bcrypt.DefaultCost)
	if err != nil {
		panic(fmt.Sprintf("failed to generate dummy bcrypt hash: %v", err))
	}
	dummyHash = h
}

// CreateAPIKey creates a new merchant API key for an organization with the specified status.
// New merchant keys use the "sg_merchants_" prefix. For agent keys, see the V0.3 agent
// key creation path (not yet implemented in V0.1).
func CreateAPIKey(ctx context.Context, pool *pgxpool.Pool, organizationID, name string, status dbengine.APIKeyStatus) (*dbengine.Merchant, string, error) {
	// Generate new merchant API key
	fullKey, keyID, err := GenerateAPIKey(KeyTypeMerchant)
	if err != nil {
		return nil, "", fmt.Errorf("failed to generate API key: %w", err)
	}

	// Hash the key for storage
	apiKeyHash, err := HashAPIKey(fullKey)
	if err != nil {
		return nil, "", fmt.Errorf("failed to hash API key: %w", err)
	}

	merchant, err := dbengine.CreateAPIKey(ctx, pool, organizationID, apiKeyHash, keyID, name, status, 10)
	if err != nil {
		return nil, "", err
	}

	return &merchant, fullKey, nil
}

// GetAPIKeysByOrganizationID retrieves all API keys for an organization without exposing hashed keys.
func GetAPIKeysByOrganizationID(ctx context.Context, pool *pgxpool.Pool, organizationID string) ([]dbengine.MerchantPublic, error) {
	return dbengine.ListAPIKeysByOrganization(ctx, pool, organizationID)
}

// AuthenticateAPIKey validates an API key and returns the associated merchant
// along with the detected key type. Uses GitHub-style indexed lookup by key_id
// for O(1) performance.
//
// Returns:
//   - (merchant, KeyTypeMerchant, nil) for valid merchant keys (legacy sg_live_ or new sg_merchants_)
//   - (nil, KeyTypeAgent, ErrInvalidAPIKey) for agent keys in V0.1 — agent authentication
//     is not yet wired up because the agent_api_keys table doesn't exist until V0.2/V0.3.
//     V0.3 will add a parallel agent-auth path that populates this branch.
//   - (nil, "", err) for malformed keys or DB errors
func AuthenticateAPIKey(ctx context.Context, pool *pgxpool.Pool, providedKey string) (*dbengine.Merchant, KeyType, error) {
	// Validate format and detect key type
	keyType, err := ValidateAPIKeyFormat(providedKey)
	if err != nil {
		return nil, "", fmt.Errorf("invalid API key format: %w", err)
	}

	// Agent keys are not yet authenticatable in V0.1 — agent_api_keys table lands in V0.2/V0.3.
	// Log and reject with ErrInvalidAPIKey so the middleware returns the same 401 it would
	// for any unauthenticated key.
	if keyType == KeyTypeAgent {
		slog.Warn("agent API key authentication attempted before V0.3 implementation",
			"key_prefix", KeyPrefixAgents)
		// Run dummy bcrypt to keep response time roughly constant
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(providedKey))
		return nil, KeyTypeAgent, ErrInvalidAPIKey
	}

	// Merchant path (covers both legacy sg_live_ and new sg_merchants_)
	keyID, err := ExtractKeyID(providedKey)
	if err != nil {
		return nil, "", fmt.Errorf("failed to extract key ID: %w", err)
	}

	// Query by key_id instead of scanning all keys (O(1) vs O(N))
	candidates, err := dbengine.GetActiveMerchantsByKeyID(ctx, pool, keyID)
	if err != nil {
		return nil, "", err
	}

	for _, merchant := range candidates {
		// Verify the key against this hash
		if VerifyAPIKey(providedKey, merchant.APIKey) {
			// Update last used timestamp — log but don't fail authentication
			if err := dbengine.UpdateMerchantLastUsedAt(ctx, pool, merchant.ID); err != nil {
				slog.Warn("failed to update last_used_at", "merchant_id", merchant.ID, "error", err)
			}

			return &merchant, KeyTypeMerchant, nil
		}
	}

	// No candidates matched!
	if len(candidates) == 0 {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(providedKey))
	}

	return nil, KeyTypeMerchant, ErrInvalidAPIKey
}

// RevokeAPIKey atomically deactivates an API key, but only if the requesting
// user is an admin of the organization that owns it.
func RevokeAPIKey(ctx context.Context, pool *pgxpool.Pool, merchantID, adminUserID string) error {
	rowsAffected, err := dbengine.RevokeMerchantAPIKey(ctx, pool, merchantID, adminUserID)
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrAPIKeyNotFound
	}
	return nil
}
