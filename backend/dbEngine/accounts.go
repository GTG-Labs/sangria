package dbengine

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CreateAccount inserts a new financial ledger account.
func CreateAccount(ctx context.Context, pool *pgxpool.Pool, name string, accountType AccountType, currency Currency, userID *string) (Account, error) {
	var a Account
	err := pool.QueryRow(ctx,
		`INSERT INTO accounts (name, type, currency, user_id)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, name, type, currency, user_id, created_at`,
		name, accountType, currency, userID,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.UserID, &a.CreatedAt)
	return a, err
}

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
