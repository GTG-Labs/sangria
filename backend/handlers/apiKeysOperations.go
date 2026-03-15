package handlers

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"sangrianet/backend/dbEngine"
)

// ErrMaxAPIKeysReached is returned when a user tries to create more than 10 API keys
var ErrMaxAPIKeysReached = errors.New("max active API keys reached")

// CreateAPIKey creates a new API key for a user
func CreateAPIKey(ctx context.Context, pool *pgxpool.Pool, userID, name string, isLive bool) (*dbengine.Merchant, string, error) {
	// Generate new API key first
	fullKey, keyID, err := GenerateAPIKey(isLive)
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
	lockQuery := `
		SELECT workos_id FROM users WHERE workos_id = $1 FOR UPDATE
	`
	var lockedUserID string
	err = tx.QueryRow(ctx, lockQuery, userID).Scan(&lockedUserID)
	if err != nil {
		return nil, "", fmt.Errorf("failed to lock user for key creation: %w", err)
	}

	// Check active key count within transaction
	countQuery := `
		SELECT COUNT(*)
		FROM merchants
		WHERE user_id = $1 AND is_active = true
	`
	var activeCount int
	err = tx.QueryRow(ctx, countQuery, userID).Scan(&activeCount)
	if err != nil {
		return nil, "", fmt.Errorf("failed to check active API key count: %w", err)
	}
	if activeCount >= 10 {
		return nil, "", ErrMaxAPIKeysReached
	}

	// Insert new key
	insertQuery := `
		INSERT INTO merchants (user_id, api_key, key_id, name, is_active, created_at)
		VALUES ($1, $2, $3, $4, true, NOW())
		RETURNING id, user_id, api_key, key_id, name, is_active, last_used_at, created_at
	`

	var merchant dbengine.Merchant
	err = tx.QueryRow(ctx, insertQuery, userID, apiKeyHash, keyID, name).Scan(
		&merchant.ID,
		&merchant.UserID,
		&merchant.APIKey,
		&merchant.KeyID,
		&merchant.Name,
		&merchant.IsActive,
		&merchant.LastUsedAt,
		&merchant.CreatedAt,
	)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create merchant: %w", err)
	}

	// Commit transaction
	err = tx.Commit(ctx)
	if err != nil {
		return nil, "", fmt.Errorf("failed to commit transaction: %w", err)
	}

	return &merchant, fullKey, nil
}

// GetAPIKeysByUserID retrieves all API keys for a user
func GetAPIKeysByUserID(ctx context.Context, pool *pgxpool.Pool, userID string) ([]dbengine.Merchant, error) {
	query := `
		SELECT id, user_id, api_key, key_id, name, is_active, last_used_at, created_at
		FROM merchants
		WHERE user_id = $1
		ORDER BY created_at DESC
	`

	rows, err := pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query merchants: %w", err)
	}
	defer rows.Close()

	var merchants []dbengine.Merchant
	for rows.Next() {
		var merchant dbengine.Merchant
		err := rows.Scan(
			&merchant.ID,
			&merchant.UserID,
			&merchant.APIKey,
			&merchant.KeyID,
			&merchant.Name,
			&merchant.IsActive,
			&merchant.LastUsedAt,
			&merchant.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan merchant: %w", err)
		}
		merchants = append(merchants, merchant)
	}

	if rows.Err() != nil {
		return nil, fmt.Errorf("error iterating merchants: %w", rows.Err())
	}

	return merchants, nil
}

// GetAPIKeyByID retrieves a specific API key by ID
func GetAPIKeyByID(ctx context.Context, pool *pgxpool.Pool, keyID string) (*dbengine.Merchant, error) {
	query := `
		SELECT id, user_id, api_key, key_id, name, is_active, last_used_at, created_at
		FROM merchants
		WHERE id = $1
	`

	var merchant dbengine.Merchant
	err := pool.QueryRow(ctx, query, keyID).Scan(
		&merchant.ID,
		&merchant.UserID,
		&merchant.APIKey,
		&merchant.KeyID,
		&merchant.Name,
		&merchant.IsActive,
		&merchant.LastUsedAt,
		&merchant.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get merchant: %w", err)
	}

	return &merchant, nil
}

// AuthenticateAPIKey validates an API key and returns the associated user
// This is used for API authentication with GitHub-style indexed lookup
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
	query := `
		SELECT id, user_id, api_key, key_id, name, is_active, last_used_at, created_at
		FROM merchants
		WHERE key_id = $1 AND is_active = true
		LIMIT 5
	`

	rows, err := pool.Query(ctx, query, keyID)
	if err != nil {
		return nil, fmt.Errorf("failed to query merchants for authentication: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var merchant dbengine.Merchant
		err := rows.Scan(
			&merchant.ID,
			&merchant.UserID,
			&merchant.APIKey,
			&merchant.KeyID,
			&merchant.Name,
			&merchant.IsActive,
			&merchant.LastUsedAt,
			&merchant.CreatedAt,
		)
		if err != nil {
			continue // Skip invalid rows
		}

		// Verify the key against this hash
		if VerifyAPIKey(providedKey, merchant.APIKey) {
			// Update last used timestamp
			_, updateErr := pool.Exec(ctx,
				"UPDATE merchants SET last_used_at = NOW() WHERE id = $1",
				merchant.ID)
			if updateErr != nil {
				// Log but don't fail authentication
				fmt.Printf("Failed to update last_used_at for merchant %s: %v\n", merchant.ID, updateErr)
			}

			return &merchant, nil
		}
	}

	if rows.Err() != nil {
		return nil, fmt.Errorf("error iterating merchants during authentication: %w", rows.Err())
	}

	// No matching key found
	return nil, fmt.Errorf("invalid API key")
}

// RevokeAPIKey deactivates an API key
func RevokeAPIKey(ctx context.Context, pool *pgxpool.Pool, keyID, userID string) error {
	query := `
		UPDATE merchants
		SET is_active = false
		WHERE id = $1 AND user_id = $2
	`

	result, err := pool.Exec(ctx, query, keyID, userID)
	if err != nil {
		return fmt.Errorf("failed to revoke API key: %w", err)
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("API key not found or not owned by user")
	}

	return nil
}

// DeleteAPIKey permanently deletes an API key
func DeleteAPIKey(ctx context.Context, pool *pgxpool.Pool, keyID, userID string) error {
	query := `
		DELETE FROM merchants
		WHERE id = $1 AND user_id = $2
	`

	result, err := pool.Exec(ctx, query, keyID, userID)
	if err != nil {
		return fmt.Errorf("failed to delete API key: %w", err)
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("API key not found or not owned by user")
	}

	return nil
}

// GetActiveAPIKeyCount returns the number of active API keys for a user
func GetActiveAPIKeyCount(ctx context.Context, pool *pgxpool.Pool, userID string) (int, error) {
	query := `
		SELECT COUNT(*)
		FROM merchants
		WHERE user_id = $1 AND is_active = true
	`

	var count int
	err := pool.QueryRow(ctx, query, userID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count active API keys: %w", err)
	}

	return count, nil
}