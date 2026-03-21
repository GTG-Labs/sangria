package dbengine

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GetMerchantByID returns a merchant by its UUID.
func GetMerchantByID(ctx context.Context, pool *pgxpool.Pool, id string) (Merchant, error) {
	var m Merchant
	err := pool.QueryRow(ctx,
		`SELECT id, user_id, api_key, key_id, name, is_active, last_used_at, created_at
		 FROM merchants WHERE id = $1`,
		id,
	).Scan(&m.ID, &m.UserID, &m.APIKey, &m.KeyID, &m.Name, &m.IsActive, &m.LastUsedAt, &m.CreatedAt)
	return m, err
}

// EnsureUSDCLiabilityAccount returns the user's USDC LIABILITY account,
// creating one if it doesn't exist yet.
func EnsureUSDCLiabilityAccount(ctx context.Context, pool *pgxpool.Pool, userID string) (Account, error) {
	var a Account
	err := pool.QueryRow(ctx,
		`SELECT id, name, type, currency, user_id, created_at
		 FROM accounts
		 WHERE user_id = $1 AND type = 'LIABILITY' AND currency = 'USDC'`,
		userID,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.UserID, &a.CreatedAt)

	if err == nil {
		return a, nil
	}

	// Only create if the account genuinely doesn't exist.
	// Any other error (connection failure, scan error, etc.) should be surfaced.
	if !errors.Is(err, pgx.ErrNoRows) {
		return Account{}, fmt.Errorf("query liability account: %w", err)
	}

	return CreateAccount(ctx, pool, "USDC Liability", AccountTypeLiability, USDC, &userID)
}

// GetMerchantUSDCLiabilityAccount returns the USDC LIABILITY account for a
// merchant's user. Used during settle-payment to credit the merchant.
func GetMerchantUSDCLiabilityAccount(ctx context.Context, pool *pgxpool.Pool, merchantID string) (Account, error) {
	var a Account
	err := pool.QueryRow(ctx,
		`SELECT a.id, a.name, a.type, a.currency, a.user_id, a.created_at
		 FROM accounts a
		 JOIN merchants m ON m.user_id = a.user_id
		 WHERE m.id = $1 AND a.type = 'LIABILITY' AND a.currency = 'USDC'`,
		merchantID,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.UserID, &a.CreatedAt)
	return a, err
}

// GetMerchantBalance returns the net USDC balance for a merchant by looking
// up their USDC LIABILITY account and computing the ledger balance.
func GetMerchantBalance(ctx context.Context, pool *pgxpool.Pool, merchantID string) (int64, error) {
	acct, err := GetMerchantUSDCLiabilityAccount(ctx, pool, merchantID)
	if err != nil {
		return 0, fmt.Errorf("get merchant liability account: %w", err)
	}
	return GetAccountBalance(ctx, pool, acct.ID, USDC)
}

// UpdateMerchantLastUsedAt updates the last_used_at timestamp for a merchant.
func UpdateMerchantLastUsedAt(ctx context.Context, pool *pgxpool.Pool, merchantID string) error {
	_, err := pool.Exec(ctx,
		`UPDATE merchants SET last_used_at = NOW() WHERE id = $1`,
		merchantID,
	)
	return err
}
