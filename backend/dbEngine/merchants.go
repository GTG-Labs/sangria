package dbengine

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrMerchantNotFound is returned when a merchant does not exist.
var ErrMerchantNotFound = errors.New("merchant not found")

// ErrMaxAPIKeysReached is returned when an organization has hit its API key limit.
var ErrMaxAPIKeysReached = errors.New("max active API keys reached")

// GetMerchantByID returns a merchant by its UUID.
func GetMerchantByID(ctx context.Context, pool *pgxpool.Pool, id string) (Merchant, error) {
	var m Merchant
	err := pool.QueryRow(ctx,
		`SELECT id, organization_id, api_key, key_id, name, status, last_used_at, created_at
		 FROM merchants WHERE id = $1`,
		id,
	).Scan(&m.ID, &m.OrganizationID, &m.APIKey, &m.KeyID, &m.Name, &m.Status, &m.LastUsedAt, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return m, ErrMerchantNotFound
	}
	return m, err
}

// EnsureUSDLiabilityAccount returns the organization's USD LIABILITY account,
// creating one if it doesn't exist yet. Uses a transaction with a row lock
// to prevent concurrent requests from creating duplicate accounts.
func EnsureUSDLiabilityAccount(ctx context.Context, pool *pgxpool.Pool, organizationID string) (Account, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Account{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the organization row to serialize concurrent calls for the same organization.
	var lockedOrgID string
	err = tx.QueryRow(ctx,
		`SELECT id FROM organizations WHERE id = $1 FOR UPDATE`,
		organizationID,
	).Scan(&lockedOrgID)
	if err != nil {
		return Account{}, fmt.Errorf("lock organization row: %w", err)
	}

	// Check if the account already exists (under the lock).
	var a Account
	err = tx.QueryRow(ctx,
		`SELECT id, name, type, currency, organization_id, created_at
		 FROM accounts
		 WHERE organization_id = $1 AND type = 'LIABILITY' AND currency = 'USD'`,
		organizationID,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.OrganizationID, &a.CreatedAt)

	if err == nil {
		tx.Commit(ctx)
		return a, nil
	}

	if !errors.Is(err, pgx.ErrNoRows) {
		return Account{}, fmt.Errorf("query liability account: %w", err)
	}

	// Account doesn't exist — create it within the same transaction.
	err = tx.QueryRow(ctx,
		`INSERT INTO accounts (name, type, currency, organization_id)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, name, type, currency, organization_id, created_at`,
		"USD Liability", AccountTypeLiability, USD, organizationID,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.OrganizationID, &a.CreatedAt)
	if err != nil {
		return Account{}, fmt.Errorf("create liability account: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Account{}, fmt.Errorf("commit transaction: %w", err)
	}

	return a, nil
}

// GetMerchantUSDLiabilityAccount returns the USD LIABILITY account for a
// merchant's organization. Used during settle-payment to credit the merchant.
func GetMerchantUSDLiabilityAccount(ctx context.Context, pool *pgxpool.Pool, merchantID string) (Account, error) {
	var a Account
	err := pool.QueryRow(ctx,
		`SELECT a.id, a.name, a.type, a.currency, a.organization_id, a.created_at
		 FROM accounts a
		 JOIN merchants m ON m.organization_id = a.organization_id
		 WHERE m.id = $1 AND a.type = 'LIABILITY' AND a.currency = 'USD'`,
		merchantID,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.OrganizationID, &a.CreatedAt)
	return a, err
}

// UpdatePendingMerchantStatus atomically updates a pending merchant's status,
// but only if the given user is an admin of the merchant's organization.
// Returns the number of rows affected (0 means not found or not authorized).
func UpdatePendingMerchantStatus(ctx context.Context, pool *pgxpool.Pool, merchantID, userID string, newStatus APIKeyStatus) (int64, error) {
	result, err := pool.Exec(ctx,
		`UPDATE merchants SET status = $1
		 FROM organization_members om
		 WHERE merchants.id = $2
		   AND merchants.status = 'pending'
		   AND merchants.organization_id = om.organization_id
		   AND om.user_id = $3
		   AND om.is_admin = true`,
		newStatus, merchantID, userID,
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

// CreateAPIKey creates a new API key for an organization within a transaction.
// It locks the organization row, checks that the org has fewer than maxKeys active/pending keys,
// and inserts the new merchant record.
func CreateAPIKey(ctx context.Context, pool *pgxpool.Pool, organizationID, apiKeyHash, keyID, name string, status APIKeyStatus, maxKeys int) (Merchant, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Merchant{}, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the organization row to prevent concurrent key creation
	var lockedOrgID string
	err = tx.QueryRow(ctx,
		`SELECT id FROM organizations WHERE id = $1 FOR UPDATE`,
		organizationID,
	).Scan(&lockedOrgID)
	if err != nil {
		return Merchant{}, fmt.Errorf("failed to lock organization for key creation: %w", err)
	}

	// Check total key count (active + pending) within transaction
	var totalCount int
	err = tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM merchants WHERE organization_id = $1 AND status IN ('active', 'pending')`,
		organizationID,
	).Scan(&totalCount)
	if err != nil {
		return Merchant{}, fmt.Errorf("failed to check API key count: %w", err)
	}
	if totalCount >= maxKeys {
		return Merchant{}, ErrMaxAPIKeysReached
	}

	// Insert new key with specified status
	var m Merchant
	err = tx.QueryRow(ctx,
		`INSERT INTO merchants (organization_id, api_key, key_id, name, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, NOW())
		 RETURNING id, organization_id, api_key, key_id, name, status, last_used_at, created_at`,
		organizationID, apiKeyHash, keyID, name, status,
	).Scan(&m.ID, &m.OrganizationID, &m.APIKey, &m.KeyID, &m.Name, &m.Status, &m.LastUsedAt, &m.CreatedAt)
	if err != nil {
		return Merchant{}, fmt.Errorf("failed to create merchant: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Merchant{}, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return m, nil
}

// ListAPIKeysByOrganization retrieves all API keys for an organization without exposing hashed keys.
func ListAPIKeysByOrganization(ctx context.Context, pool *pgxpool.Pool, organizationID string) ([]MerchantPublic, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, organization_id, key_id, name, status, last_used_at, created_at
		 FROM merchants WHERE organization_id = $1 ORDER BY created_at DESC`,
		organizationID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query merchants: %w", err)
	}
	defer rows.Close()

	var merchants []MerchantPublic
	for rows.Next() {
		var m MerchantPublic
		if err := rows.Scan(&m.ID, &m.OrganizationID, &m.KeyID, &m.Name, &m.Status, &m.LastUsedAt, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan merchant: %w", err)
		}
		merchants = append(merchants, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating merchants: %w", err)
	}

	return merchants, nil
}

// GetActiveMerchantsByKeyID returns all active merchants matching a key_id prefix.
// Used during API key authentication to find candidates for hash verification.
func GetActiveMerchantsByKeyID(ctx context.Context, pool *pgxpool.Pool, keyID string) ([]Merchant, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, organization_id, api_key, key_id, name, status, last_used_at, created_at
		 FROM merchants WHERE key_id = $1 AND status = 'active' LIMIT 5`,
		keyID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query merchants for authentication: %w", err)
	}
	defer rows.Close()

	var merchants []Merchant
	for rows.Next() {
		var m Merchant
		if err := rows.Scan(&m.ID, &m.OrganizationID, &m.APIKey, &m.KeyID, &m.Name, &m.Status, &m.LastUsedAt, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan merchant: %w", err)
		}
		merchants = append(merchants, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating merchants: %w", err)
	}

	return merchants, nil
}

// RevokeMerchantAPIKey atomically deactivates an API key, but only if the requesting
// user is an admin of the organization that owns it.
func RevokeMerchantAPIKey(ctx context.Context, pool *pgxpool.Pool, merchantID, adminUserID string) (int64, error) {
	result, err := pool.Exec(ctx,
		`UPDATE merchants SET status = 'inactive'
		 FROM organization_members om
		 WHERE merchants.id = $1
		   AND merchants.status IN ('active', 'pending')
		   AND merchants.organization_id = om.organization_id
		   AND om.user_id = $2
		   AND om.is_admin = true`,
		merchantID, adminUserID,
	)
	if err != nil {
		return 0, fmt.Errorf("failed to revoke API key: %w", err)
	}
	return result.RowsAffected(), nil
}

// UpdateMerchantLastUsedAt updates the last_used_at timestamp for a merchant.
func UpdateMerchantLastUsedAt(ctx context.Context, pool *pgxpool.Pool, merchantID string) error {
	_, err := pool.Exec(ctx,
		`UPDATE merchants SET last_used_at = NOW() WHERE id = $1`,
		merchantID,
	)
	return err
}
