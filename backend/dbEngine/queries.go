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

// GetAllAccounts returns every account in the table.
func GetAllAccounts(ctx context.Context, pool *pgxpool.Pool) ([]Account, error) {
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

// InsertTransaction creates a new transaction and returns the full row.
func InsertTransaction(ctx context.Context, pool *pgxpool.Pool, fromAccount, toAccount int64, value string) (Transaction, error) {
	var t Transaction
	err := pool.QueryRow(ctx,
		`INSERT INTO transactions (from_account, to_account, value)
		 VALUES ($1, $2, $3)
		 RETURNING id, from_account, to_account, value, created_at`,
		fromAccount, toAccount, value,
	).Scan(&t.ID, &t.FromAccount, &t.ToAccount, &t.Value, &t.CreatedAt)
	return t, err
}

// GetAllTransactions returns every transaction in the table.
func GetAllTransactions(ctx context.Context, pool *pgxpool.Pool) ([]Transaction, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, from_account, to_account, value, created_at FROM transactions ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txns []Transaction
	for rows.Next() {
		var t Transaction
		if err := rows.Scan(&t.ID, &t.FromAccount, &t.ToAccount, &t.Value, &t.CreatedAt); err != nil {
			return nil, err
		}
		txns = append(txns, t)
	}
	return txns, rows.Err()
}
