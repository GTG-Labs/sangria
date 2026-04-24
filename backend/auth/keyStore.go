package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	dbengine "sangria/backend/dbEngine"
)

// ErrAPIKeyNotFound is returned when an API key does not exist or is not owned by the user.
var ErrAPIKeyNotFound = errors.New("API key not found or not owned by user")

// CreateAPIKey creates a new API key for an organization with the specified status.
func CreateAPIKey(ctx context.Context, pool *pgxpool.Pool, organizationID, name string, status dbengine.APIKeyStatus) (*dbengine.Merchant, string, error) {
	// Generate new API key first
	fullKey, keyID, err := GenerateAPIKey()
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

// AuthenticateAPIKey validates an API key and returns the associated merchant.
// Uses GitHub-style indexed lookup by key_id for O(1) performance.
func AuthenticateAPIKey(ctx context.Context, pool *pgxpool.Pool, providedKey string) (*dbengine.Merchant, error) {
	// Validate format first
	if err := ValidateAPIKeyFormat(providedKey); err != nil {
		return nil, fmt.Errorf("invalid API key format: %w", err)
	}

	// Extract key_id for indexed lookup
	keyID, err := ExtractKeyID(providedKey)
	if err != nil {
		return nil, fmt.Errorf("failed to extract key ID: %w", err)
	}

	// Query by key_id instead of scanning all keys (O(1) vs O(N))
	candidates, err := dbengine.GetActiveMerchantsByKeyID(ctx, pool, keyID)
	if err != nil {
		return nil, err
	}

	for _, merchant := range candidates {
		// Verify the key against this hash
		if VerifyAPIKey(providedKey, merchant.APIKey) {
			// Update last used timestamp — log but don't fail authentication
			if err := dbengine.UpdateMerchantLastUsedAt(ctx, pool, merchant.ID); err != nil {
				slog.Warn("failed to update last_used_at", "merchant_id", merchant.ID, "error", err)
			}

			return &merchant, nil
		}
	}

	return nil, fmt.Errorf("invalid API key")
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
