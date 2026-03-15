package dbengine

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// GetAllAccounts returns all financial ledger accounts.
func GetAllAccounts(ctx context.Context, pool *pgxpool.Pool) ([]Account, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, name, type, currency, user_id, created_at FROM accounts ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []Account
	for rows.Next() {
		var a Account
		if err := rows.Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.UserID, &a.CreatedAt); err != nil {
			return nil, err
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

// GetAccountsByType returns financial ledger accounts filtered by type.
func GetAccountsByType(ctx context.Context, pool *pgxpool.Pool, accountType AccountType) ([]Account, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, name, type, currency, user_id, created_at FROM accounts WHERE type = $1 ORDER BY created_at`,
		accountType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []Account
	for rows.Next() {
		var a Account
		if err := rows.Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.UserID, &a.CreatedAt); err != nil {
			return nil, err
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

// GetAllTransactions returns all transactions.
func GetAllTransactions(ctx context.Context, pool *pgxpool.Pool) ([]Transaction, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, idempotency_key, created_at FROM transactions ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txns []Transaction
	for rows.Next() {
		var t Transaction
		if err := rows.Scan(&t.ID, &t.IdempotencyKey, &t.CreatedAt); err != nil {
			return nil, err
		}
		txns = append(txns, t)
	}
	return txns, rows.Err()
}

// GetAllLedgerEntries returns all ledger entries ordered by transaction.
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

// GetLedgerEntriesByTransaction returns ledger entries for a specific transaction.
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

// GetAccountBalance computes the net balance for an account in a given currency.
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
