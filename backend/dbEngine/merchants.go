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

// GetMerchantByID returns a merchant by its UUID.
func GetMerchantByID(ctx context.Context, pool *pgxpool.Pool, id string) (Merchant, error) {
	var m Merchant
	err := pool.QueryRow(ctx,
		`SELECT id, user_id, api_key, key_id, name, is_active, last_used_at, created_at
		 FROM merchants WHERE id = $1`,
		id,
	).Scan(&m.ID, &m.UserID, &m.APIKey, &m.KeyID, &m.Name, &m.IsActive, &m.LastUsedAt, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return m, ErrMerchantNotFound
	}
	return m, err
}

// EnsureUSDLiabilityAccount returns the user's USD LIABILITY account,
// creating one if it doesn't exist yet. Uses a transaction with a row lock
// to prevent concurrent requests from creating duplicate accounts.
func EnsureUSDLiabilityAccount(ctx context.Context, pool *pgxpool.Pool, userID string) (Account, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Account{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the user row to serialize concurrent calls for the same user.
	var lockedUserID string
	err = tx.QueryRow(ctx,
		`SELECT workos_id FROM users WHERE workos_id = $1 FOR UPDATE`,
		userID,
	).Scan(&lockedUserID)
	if err != nil {
		return Account{}, fmt.Errorf("lock user row: %w", err)
	}

	// Check if the account already exists (under the lock).
	var a Account
	err = tx.QueryRow(ctx,
		`SELECT id, name, type, currency, user_id, created_at
		 FROM accounts
		 WHERE user_id = $1 AND type = 'LIABILITY' AND currency = 'USD'`,
		userID,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.UserID, &a.CreatedAt)

	if err == nil {
		tx.Commit(ctx)
		return a, nil
	}

	if !errors.Is(err, pgx.ErrNoRows) {
		return Account{}, fmt.Errorf("query liability account: %w", err)
	}

	// Account doesn't exist — create it within the same transaction.
	err = tx.QueryRow(ctx,
		`INSERT INTO accounts (name, type, currency, user_id)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, name, type, currency, user_id, created_at`,
		"USD Liability", AccountTypeLiability, USD, userID,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.UserID, &a.CreatedAt)
	if err != nil {
		return Account{}, fmt.Errorf("create liability account: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Account{}, fmt.Errorf("commit transaction: %w", err)
	}

	return a, nil
}

// GetMerchantUSDLiabilityAccount returns the USD LIABILITY account for a
// merchant's user. Used during settle-payment to credit the merchant.
func GetMerchantUSDLiabilityAccount(ctx context.Context, pool *pgxpool.Pool, merchantID string) (Account, error) {
	var a Account
	err := pool.QueryRow(ctx,
		`SELECT a.id, a.name, a.type, a.currency, a.user_id, a.created_at
		 FROM accounts a
		 JOIN merchants m ON m.user_id = a.user_id
		 WHERE m.id = $1 AND a.type = 'LIABILITY' AND a.currency = 'USD'`,
		merchantID,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.UserID, &a.CreatedAt)
	return a, err
}

// UpdateMerchantLastUsedAt updates the last_used_at timestamp for a merchant.
func UpdateMerchantLastUsedAt(ctx context.Context, pool *pgxpool.Pool, merchantID string) error {
	_, err := pool.Exec(ctx,
		`UPDATE merchants SET last_used_at = NOW() WHERE id = $1`,
		merchantID,
	)
	return err
}
