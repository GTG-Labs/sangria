package dbengine

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

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
