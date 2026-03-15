package dbengine

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CreateAPIKey creates a new API key for a user
func CreateAPIKey(ctx context.Context, pool *pgxpool.Pool, userID, name string, isLive bool) (*Merchant, string, error) {
	// Generate new API key
	fullKey, _, err := GenerateAPIKey(isLive) // Ignore display ID since we don't store it
	if err != nil {
		return nil, "", fmt.Errorf("failed to generate API key: %w", err)
	}

	// Hash the key for storage
	apiKeyHash, err := HashAPIKey(fullKey)
	if err != nil {
		return nil, "", fmt.Errorf("failed to hash API key: %w", err)
	}

	// Insert into database - store only the hash, like GitHub
	query := `
		INSERT INTO merchants (user_id, api_key, name, is_active, created_at)
		VALUES ($1, $2, $3, true, NOW())
		RETURNING id, user_id, api_key, name, is_active, last_used_at, created_at
	`

	var merchant Merchant
	err = pool.QueryRow(ctx, query, userID, apiKeyHash, name).Scan(
		&merchant.ID,
		&merchant.UserID,
		&merchant.APIKey,
		&merchant.Name,
		&merchant.IsActive,
		&merchant.LastUsedAt,
		&merchant.CreatedAt,
	)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create merchant: %w", err)
	}

	return &merchant, fullKey, nil
}

// GetAPIKeysByUserID retrieves all API keys for a user
func GetAPIKeysByUserID(ctx context.Context, pool *pgxpool.Pool, userID string) ([]Merchant, error) {
	query := `
		SELECT id, user_id, api_key, name, is_active, last_used_at, created_at
		FROM merchants
		WHERE user_id = $1
		ORDER BY created_at DESC
	`

	rows, err := pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query merchants: %w", err)
	}
	defer rows.Close()

	var merchants []Merchant
	for rows.Next() {
		var merchant Merchant
		err := rows.Scan(
			&merchant.ID,
			&merchant.UserID,
			&merchant.APIKey,
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
func GetAPIKeyByID(ctx context.Context, pool *pgxpool.Pool, keyID string) (*Merchant, error) {
	query := `
		SELECT id, user_id, api_key, name, is_active, last_used_at, created_at
		FROM merchants
		WHERE id = $1
	`

	var merchant Merchant
	err := pool.QueryRow(ctx, query, keyID).Scan(
		&merchant.ID,
		&merchant.UserID,
		&merchant.APIKey,
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
// This is used for API authentication
func AuthenticateAPIKey(ctx context.Context, pool *pgxpool.Pool, providedKey string) (*Merchant, error) {
	// Validate format first
	if err := ValidateAPIKeyFormat(providedKey); err != nil {
		return nil, fmt.Errorf("invalid API key format: %w", err)
	}

	// Query all active API keys - we need to check hashes
	query := `
		SELECT id, user_id, api_key, name, is_active, last_used_at, created_at
		FROM merchants
		WHERE is_active = true
	`

	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query merchants for authentication: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var merchant Merchant
		err := rows.Scan(
			&merchant.ID,
			&merchant.UserID,
			&merchant.APIKey,
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