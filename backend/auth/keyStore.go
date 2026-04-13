package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	dbengine "sangria/backend/dbEngine"
)

// ErrMaxAPIKeysReached is returned when a user tries to create more than 10 API keys.
var ErrMaxAPIKeysReached = errors.New("max active API keys reached")

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

	// Use transaction to prevent race condition
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, "", fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the organization row to prevent concurrent key creation
	var lockedOrgID string
	err = tx.QueryRow(ctx,
		`SELECT id FROM organizations WHERE id = $1 FOR UPDATE`,
		organizationID,
	).Scan(&lockedOrgID)
	if err != nil {
		return nil, "", fmt.Errorf("failed to lock organization for key creation: %w", err)
	}

	// Check active key count within transaction
	var activeCount int
	err = tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM merchants WHERE organization_id = $1 AND status = 'active'`,
		organizationID,
	).Scan(&activeCount)
	if err != nil {
		return nil, "", fmt.Errorf("failed to check active API key count: %w", err)
	}
	if activeCount >= 10 {
		return nil, "", ErrMaxAPIKeysReached
	}

	// Insert new key with specified status
	var merchant dbengine.Merchant
	err = tx.QueryRow(ctx,
		`INSERT INTO merchants (organization_id, api_key, key_id, name, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, NOW())
		 RETURNING id, organization_id, api_key, key_id, name, status, last_used_at, created_at`,
		organizationID, apiKeyHash, keyID, name, status,
	).Scan(
		&merchant.ID, &merchant.OrganizationID, &merchant.APIKey, &merchant.KeyID,
		&merchant.Name, &merchant.Status, &merchant.LastUsedAt, &merchant.CreatedAt,
	)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create merchant: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, "", fmt.Errorf("failed to commit transaction: %w", err)
	}

	return &merchant, fullKey, nil
}

// GetAPIKeysByOrganizationID retrieves all API keys for an organization without exposing hashed keys.
func GetAPIKeysByOrganizationID(ctx context.Context, pool *pgxpool.Pool, organizationID string) ([]dbengine.MerchantPublic, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, organization_id, key_id, name, status, last_used_at, created_at
		 FROM merchants WHERE organization_id = $1 ORDER BY created_at DESC`,
		organizationID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query merchants: %w", err)
	}
	defer rows.Close()

	var merchants []dbengine.MerchantPublic
	for rows.Next() {
		var m dbengine.MerchantPublic
		if err := rows.Scan(
			&m.ID, &m.OrganizationID, &m.KeyID,
			&m.Name, &m.Status, &m.LastUsedAt, &m.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan merchant: %w", err)
		}
		merchants = append(merchants, m)
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("error iterating merchants: %w", rows.Err())
	}

	return merchants, nil
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
	// Only allow active keys to authenticate
	rows, err := pool.Query(ctx,
		`SELECT id, organization_id, api_key, key_id, name, status, last_used_at, created_at
		 FROM merchants WHERE key_id = $1 AND status = 'active' LIMIT 5`,
		keyID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query merchants for authentication: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var merchant dbengine.Merchant
		err := rows.Scan(
			&merchant.ID, &merchant.OrganizationID, &merchant.APIKey, &merchant.KeyID,
			&merchant.Name, &merchant.Status, &merchant.LastUsedAt, &merchant.CreatedAt,
		)
		if err != nil {
			continue
		}

		// Verify the key against this hash
		if VerifyAPIKey(providedKey, merchant.APIKey) {
			// Update last used timestamp — log but don't fail authentication
			if err := dbengine.UpdateMerchantLastUsedAt(ctx, pool, merchant.ID); err != nil {
				slog.Warn("failed to update last_used_at", "merchant_id", merchant.ID, "error", err)
			}

			return &merchant, nil
		}
	}

	if rows.Err() != nil {
		return nil, fmt.Errorf("error iterating merchants during authentication: %w", rows.Err())
	}

	return nil, fmt.Errorf("invalid API key")
}

// RevokeAPIKey deactivates an API key (admin-only).
// Checks that the requesting user is an admin of the organization that owns the API key.
func RevokeAPIKey(ctx context.Context, pool *pgxpool.Pool, merchantID, adminUserID string) error {
	// First verify the admin has permission to revoke this API key
	var organizationID string
	err := pool.QueryRow(ctx, `
		SELECT m.organization_id
		FROM merchants m
		JOIN organization_members om ON om.organization_id = m.organization_id
		WHERE m.id = $1 AND om.user_id = $2 AND om.is_admin = true`,
		merchantID, adminUserID,
	).Scan(&organizationID)

	if errors.Is(err, pgx.ErrNoRows) {
		return ErrAPIKeyNotFound
	}
	if err != nil {
		return fmt.Errorf("failed to verify admin permissions: %w", err)
	}

	// Admin verified, now deactivate the API key
	result, err := pool.Exec(ctx,
		`UPDATE merchants SET status = 'inactive' WHERE id = $1 AND organization_id = $2`,
		merchantID, organizationID,
	)
	if err != nil {
		return fmt.Errorf("failed to revoke API key: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrAPIKeyNotFound
	}
	return nil
}
