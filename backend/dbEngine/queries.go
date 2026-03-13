package dbengine

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// InsertAccount creates a new account and returns the full row.
func InsertAccount(ctx context.Context, pool *pgxpool.Pool, accountNumber, owner, workosID string) (Account, error) {
	var a Account
	err := pool.QueryRow(ctx,
		`INSERT INTO accounts (account_number, owner, workos_id)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (workos_id) DO UPDATE
		 	SET owner = EXCLUDED.owner
		 RETURNING id, account_number, owner, workos_id, created_at, updated_at`,
		accountNumber, owner, workosID,
	).Scan(&a.ID, &a.AccountNumber, &a.Owner, &a.WorkosID, &a.CreatedAt, &a.UpdatedAt)
	return a, err
}

func GetAccountsByType(ctx context.Context, pool *pgxpool.Pool, accountType AccountType) ([]Account, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, account_number, owner, workos_id, created_at, updated_at FROM accounts ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []Account
	for rows.Next() {
		var a Account
		if err := rows.Scan(&a.ID, &a.AccountNumber, &a.Owner, &a.WorkosID, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

func GetAllLedgerEntries(ctx context.Context, pool *pgxpool.Pool) ([]LedgerEntry, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, transaction_id, currency, amount, direction, account_id
		 FROM ledger_entries ORDER BY transaction_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []LedgerEntry
	for rows.Next() {
		var e LedgerEntry
		if err := rows.Scan(&e.ID, &e.TransactionID, &e.Currency, &e.Amount, &e.Direction,
			&e.AccountID); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func GetLedgerEntriesByTransaction(ctx context.Context, pool *pgxpool.Pool, txID string) ([]LedgerEntry, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, transaction_id, currency, amount, direction, account_id
		 FROM ledger_entries WHERE transaction_id = $1 ORDER BY id`, txID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []LedgerEntry
	for rows.Next() {
		var e LedgerEntry
		if err := rows.Scan(&e.ID, &e.TransactionID, &e.Currency, &e.Amount, &e.Direction,
			&e.AccountID); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func GetAccountBalance(ctx context.Context, pool *pgxpool.Pool, accountID string, currency Currency) (int64, error) {
	var balance int64
	err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(
			CASE direction
				WHEN 'CREDIT' THEN amount
				WHEN 'DEBIT'  THEN -amount
			END
		), 0)
		FROM ledger_entries
		WHERE account_id = $1 AND currency = $2`,
		accountID, currency,
	).Scan(&balance)
	return balance, err
}
