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
	SystemAccountConversionClearing        = "Conversion Clearing"
	SystemAccountPlatformFeeRevenue        = "Platform Fee Revenue"
	SystemAccountConversionFees            = "Conversion Fees"
	SystemAccountGasFees                   = "Gas Fees"
	SystemAccountUSDMerchantPool           = "USD Merchant Pool"
	SystemAccountOwnerEquity               = "Owner Equity"
	SystemAccountWithdrawalClearing        = "Withdrawal Clearing"
	SystemAccountTrialGrantsIssued         = "Trial Grants Issued"
	SystemAccountMerchantSettlementPayable = "Merchant Settlement Payable"
)

// ensureSystemAccount creates a system-level account if it doesn't exist.
// System accounts have no organization_id (nil). Uses advisory lock to prevent
// concurrent startups from creating duplicates.
func ensureSystemAccount(ctx context.Context, tx pgx.Tx, name string, accountType AccountType, currency Currency) (Account, error) {
	var a Account
	err := tx.QueryRow(ctx,
		`SELECT id, name, type, currency, organization_id, created_at
		 FROM accounts
		 WHERE name = $1 AND type = $2 AND currency = $3 AND organization_id IS NULL`,
		name, accountType, currency,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.OrganizationID, &a.CreatedAt)

	if err == nil {
		return a, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Account{}, fmt.Errorf("query system account %q: %w", name, err)
	}

	err = tx.QueryRow(ctx,
		`INSERT INTO accounts (name, type, currency, organization_id)
		 VALUES ($1, $2, $3, NULL)
		 RETURNING id, name, type, currency, organization_id, created_at`,
		name, accountType, currency,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.OrganizationID, &a.CreatedAt)
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

		// Trial grants issued — marketing-funded expense, debited each time a new
		// agent operator receives their signup trial credit.
		{SystemAccountTrialGrantsIssued, AccountTypeExpense, USD},

		// Merchant settlement payable — accrues when an operator confirms a
		// sangria-native /v1/buy order. CREDIT lands here, operator's
		// Agent Credits Trial/Paid get DEBITed. Drains to USDC/cash when
		// real merchant payouts ship (V2+).
		{SystemAccountMerchantSettlementPayable, AccountTypeLiability, USD},
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
// Accepts either a pool or a pgx.Tx via the queryer interface so it can be
// composed inside an outer atomic transaction.
func GetSystemAccount(ctx context.Context, q queryer, name string, currency Currency) (Account, error) {
	var a Account
	err := q.QueryRow(ctx,
		`SELECT id, name, type, currency, organization_id, created_at
		 FROM accounts
		 WHERE name = $1 AND currency = $2 AND organization_id IS NULL`,
		name, currency,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.OrganizationID, &a.CreatedAt)
	return a, err
}

// MerchantSettlementPayableAccountID returns the ID of the singleton
// "Merchant Settlement Payable" (LIABILITY/USD) system account. Thin wrapper
// over GetSystemAccount — sangria-native confirm flows call this to build
// ledger lines without rediscovering the lookup arguments each time.
//
// Returns pgx.ErrNoRows if EnsureSystemAccounts hasn't run yet — treat as
// 500 internal in the handler. The row is created at backend startup and
// is idempotent; see deploy-order note in agent-sdk-planning/BUY_ENDPOINT_PLAN.md.
func MerchantSettlementPayableAccountID(ctx context.Context, q queryer) (string, error) {
	a, err := GetSystemAccount(ctx, q, SystemAccountMerchantSettlementPayable, USD)
	if err != nil {
		return "", err
	}
	return a.ID, nil
}
