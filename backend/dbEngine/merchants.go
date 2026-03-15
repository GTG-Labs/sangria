package dbengine

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// CreateMerchant inserts a new merchant with a bcrypt-hashed API key and
// ensures the user has a USDC LIABILITY account (creates one if not).
// Returns the merchant record. The caller is responsible for returning the
// raw key to the user exactly once.
func CreateMerchant(ctx context.Context, pool *pgxpool.Pool, userID, name, rawAPIKey string) (Merchant, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(rawAPIKey), bcrypt.DefaultCost)
	if err != nil {
		return Merchant{}, fmt.Errorf("hash api key: %w", err)
	}

	// Ensure the user has a USDC LIABILITY account.
	_, err = EnsureUSDCLiabilityAccount(ctx, pool, userID)
	if err != nil {
		return Merchant{}, fmt.Errorf("ensure usdc liability account: %w", err)
	}

	var m Merchant
	err = pool.QueryRow(ctx,
		`INSERT INTO merchants (user_id, api_key, name)
		 VALUES ($1, $2, $3)
		 RETURNING id, user_id, api_key, name, is_active, last_used_at, created_at`,
		userID, string(hash), name,
	).Scan(&m.ID, &m.UserID, &m.ApiKey, &m.Name, &m.IsActive, &m.LastUsedAt, &m.CreatedAt)
	return m, err
}

// GetMerchantByID returns a merchant by its UUID.
func GetMerchantByID(ctx context.Context, pool *pgxpool.Pool, id string) (Merchant, error) {
	var m Merchant
	err := pool.QueryRow(ctx,
		`SELECT id, user_id, api_key, name, is_active, last_used_at, created_at
		 FROM merchants WHERE id = $1`,
		id,
	).Scan(&m.ID, &m.UserID, &m.ApiKey, &m.Name, &m.IsActive, &m.LastUsedAt, &m.CreatedAt)
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

	// Account doesn't exist — create it.
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

// TODO: API key lookup mechanism (bcrypt can't be used in WHERE clauses).
// Being handled separately — will need a prefix/identifier approach for O(1) lookup.
