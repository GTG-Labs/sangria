package dbengine

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// System account names — used as lookup keys. Must be unique.
const (
	SystemAccountConversionClearing = "Conversion Clearing"
	SystemAccountPlatformFeeRevenue = "Platform Fee Revenue"
	SystemAccountConversionFees     = "Conversion Fees"
	SystemAccountGasFees            = "Gas Fees"
	SystemAccountUSDMerchantPool    = "USD Merchant Pool"
	SystemAccountOwnerEquity        = "Owner Equity"
	SystemAccountWithdrawalClearing = "Withdrawal Clearing"
)

// ensureSystemAccount creates a system-level account if it doesn't exist.
// System accounts have no user_id (nil). Uses advisory lock to prevent
// concurrent startups from creating duplicates.
func ensureSystemAccount(ctx context.Context, tx pgx.Tx, name string, accountType AccountType, currency Currency) (Account, error) {
	var a Account
	err := tx.QueryRow(ctx,
		`SELECT id, name, type, currency, user_id, created_at
		 FROM accounts
		 WHERE name = $1 AND type = $2 AND currency = $3 AND user_id IS NULL`,
		name, accountType, currency,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.UserID, &a.CreatedAt)

	if err == nil {
		return a, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Account{}, fmt.Errorf("query system account %q: %w", name, err)
	}

	err = tx.QueryRow(ctx,
		`INSERT INTO accounts (name, type, currency, user_id)
		 VALUES ($1, $2, $3, NULL)
		 RETURNING id, name, type, currency, user_id, created_at`,
		name, accountType, currency,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.UserID, &a.CreatedAt)
	if err != nil {
		return Account{}, fmt.Errorf("create system account %q: %w", name, err)
	}
	return a, nil
}

// EnsureSystemAccounts creates all system-level ledger accounts needed for
// the cross-currency payment flow. Runs in a single transaction with an
// advisory lock to prevent concurrent startups from creating duplicates.
// Safe to call multiple times — skips accounts that already exist.
func EnsureSystemAccounts(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Advisory lock prevents concurrent instances from racing.
	// The lock ID (1) is arbitrary but must be consistent.
	_, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(1)`)
	if err != nil {
		return fmt.Errorf("acquire advisory lock: %w", err)
	}

	accounts := []struct {
		Name     string
		Type     AccountType
		Currency Currency
	}{
		// Conversion clearing — bridge between USDC and USD.
		{SystemAccountConversionClearing, AccountTypeAsset, USDC},
		{SystemAccountConversionClearing, AccountTypeAsset, USD},

		// Platform fee revenue — Sangria's cut per transaction.
		{SystemAccountPlatformFeeRevenue, AccountTypeRevenue, USD},

		// Conversion fees — off-ramp fees when batch converting USDC → USD.
		{SystemAccountConversionFees, AccountTypeExpense, USD},

		// Gas fees — on-chain transaction costs (for when we become our own facilitator).
		{SystemAccountGasFees, AccountTypeExpense, USD},

		// USD merchant pool — pre-funded pool for merchant payouts.
		{SystemAccountUSDMerchantPool, AccountTypeAsset, USD},

		// Owner equity — tracks capital deposited by Sangria into the treasury.
		{SystemAccountOwnerEquity, AccountTypeEquity, USD},

		// Withdrawal clearing — holds funds in transit during merchant payouts.
		{SystemAccountWithdrawalClearing, AccountTypeAsset, USD},
	}

	for _, a := range accounts {
		if _, err := ensureSystemAccount(ctx, tx, a.Name, a.Type, a.Currency); err != nil {
			return fmt.Errorf("ensure system account %q (%s): %w", a.Name, a.Currency, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit system accounts: %w", err)
	}

	return nil
}

// GetSystemAccount retrieves a system-level account by name and currency.
func GetSystemAccount(ctx context.Context, pool *pgxpool.Pool, name string, currency Currency) (Account, error) {
	var a Account
	err := pool.QueryRow(ctx,
		`SELECT id, name, type, currency, user_id, created_at
		 FROM accounts
		 WHERE name = $1 AND currency = $2 AND user_id IS NULL`,
		name, currency,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.UserID, &a.CreatedAt)
	return a, err
}
