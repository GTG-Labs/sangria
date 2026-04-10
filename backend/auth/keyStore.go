package auth

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
	dbengine "sangria/backend/dbEngine"
)

// ErrMaxAPIKeysReached is returned when a user tries to create more than 10 API keys.
var ErrMaxAPIKeysReached = errors.New("max active API keys reached")

// CreateAPIKey creates a new API key for a user.
func CreateAPIKey(ctx context.Context, pool *pgxpool.Pool, userID, name string) (*dbengine.Merchant, string, error) {
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

	// Lock the user row to prevent concurrent key creation
	var lockedUserID string
	err = tx.QueryRow(ctx,
		`SELECT workos_id FROM users WHERE workos_id = $1 FOR UPDATE`,
		userID,
	).Scan(&lockedUserID)
	if err != nil {
		return nil, "", fmt.Errorf("failed to lock user for key creation: %w", err)
	}

	// Check active key count within transaction
	var activeCount int
	err = tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM merchants WHERE user_id = $1 AND is_active = true`,
		userID,
	).Scan(&activeCount)
	if err != nil {
		return nil, "", fmt.Errorf("failed to check active API key count: %w", err)
	}
	if activeCount >= 10 {
		return nil, "", ErrMaxAPIKeysReached
	}

	// Insert new key
	var merchant dbengine.Merchant
	err = tx.QueryRow(ctx,
		`INSERT INTO merchants (user_id, api_key, key_id, name, is_active, created_at)
		 VALUES ($1, $2, $3, $4, true, NOW())
		 RETURNING id, user_id, api_key, key_id, name, is_active, last_used_at, created_at`,
		userID, apiKeyHash, keyID, name,
	).Scan(
		&merchant.ID, &merchant.UserID, &merchant.APIKey, &merchant.KeyID,
		&merchant.Name, &merchant.IsActive, &merchant.LastUsedAt, &merchant.CreatedAt,
	)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create merchant: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, "", fmt.Errorf("failed to commit transaction: %w", err)
	}

	return &merchant, fullKey, nil
}

// GetAPIKeysByUserID retrieves all API keys for a user.
func GetAPIKeysByUserID(ctx context.Context, pool *pgxpool.Pool, userID string) ([]dbengine.Merchant, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, user_id, api_key, key_id, name, is_active, last_used_at, created_at
		 FROM merchants WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query merchants: %w", err)
	}
	defer rows.Close()

	var merchants []dbengine.Merchant
	for rows.Next() {
		var m dbengine.Merchant
		if err := rows.Scan(
			&m.ID, &m.UserID, &m.APIKey, &m.KeyID,
			&m.Name, &m.IsActive, &m.LastUsedAt, &m.CreatedAt,
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
	rows, err := pool.Query(ctx,
		`SELECT id, user_id, api_key, key_id, name, is_active, last_used_at, created_at
		 FROM merchants WHERE key_id = $1 AND is_active = true LIMIT 5`,
		keyID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query merchants for authentication: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var merchant dbengine.Merchant
		err := rows.Scan(
			&merchant.ID, &merchant.UserID, &merchant.APIKey, &merchant.KeyID,
			&merchant.Name, &merchant.IsActive, &merchant.LastUsedAt, &merchant.CreatedAt,
		)
		if err != nil {
			continue
		}

		// Verify the key against this hash
		if VerifyAPIKey(providedKey, merchant.APIKey) {
			// Update last used timestamp — log but don't fail authentication
			if err := dbengine.UpdateMerchantLastUsedAt(ctx, pool, merchant.ID); err != nil {
				log.Printf("failed to update last_used_at for merchant %s: %v", merchant.ID, err)
			}

			return &merchant, nil
		}
	}

	if rows.Err() != nil {
		return nil, fmt.Errorf("error iterating merchants during authentication: %w", rows.Err())
	}

	return nil, fmt.Errorf("invalid API key")
}

// RevokeAPIKey deactivates an API key.
func RevokeAPIKey(ctx context.Context, pool *pgxpool.Pool, merchantID, userID string) error {
	result, err := pool.Exec(ctx,
		`UPDATE merchants SET is_active = false WHERE id = $1 AND user_id = $2`,
		merchantID, userID,
	)
	if err != nil {
		return fmt.Errorf("failed to revoke API key: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("API key not found or not owned by user")
	}
	return nil
}
