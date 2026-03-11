package dbengine

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

func GetAllAssets(ctx context.Context, pool *pgxpool.Pool) ([]Asset, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, name, currency, created_at FROM assets ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var assets []Asset
	for rows.Next() {
		var a Asset
		if err := rows.Scan(&a.ID, &a.Name, &a.Currency, &a.CreatedAt); err != nil {
			return nil, err
		}
		assets = append(assets, a)
	}
	return assets, rows.Err()
}

func GetAllLiabilities(ctx context.Context, pool *pgxpool.Pool) ([]Liability, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, name, currency, user_id, created_at FROM liabilities ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var liabilities []Liability
	for rows.Next() {
		var l Liability
		if err := rows.Scan(&l.ID, &l.Name, &l.Currency, &l.UserID, &l.CreatedAt); err != nil {
			return nil, err
		}
		liabilities = append(liabilities, l)
	}
	return liabilities, rows.Err()
}

func GetAllExpenses(ctx context.Context, pool *pgxpool.Pool) ([]Expense, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, name, currency, created_at FROM expenses ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var expenses []Expense
	for rows.Next() {
		var e Expense
		if err := rows.Scan(&e.ID, &e.Name, &e.Currency, &e.CreatedAt); err != nil {
			return nil, err
		}
		expenses = append(expenses, e)
	}
	return expenses, rows.Err()
}

func GetAllRevenues(ctx context.Context, pool *pgxpool.Pool) ([]Revenue, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, name, currency, created_at FROM revenues ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var revenues []Revenue
	for rows.Next() {
		var r Revenue
		if err := rows.Scan(&r.ID, &r.Name, &r.Currency, &r.CreatedAt); err != nil {
			return nil, err
		}
		revenues = append(revenues, r)
	}
	return revenues, rows.Err()
}

func GetAllLedgerEntries(ctx context.Context, pool *pgxpool.Pool) ([]LedgerEntry, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, transaction_id, currency, amount, direction, asset_id, liability_id, expense_id, revenue_id
		 FROM ledger_entries ORDER BY transaction_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []LedgerEntry
	for rows.Next() {
		var e LedgerEntry
		if err := rows.Scan(&e.ID, &e.TransactionID, &e.Currency, &e.Amount, &e.Direction,
			&e.AssetID, &e.LiabilityID, &e.ExpenseID, &e.RevenueID); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func GetLedgerEntriesByTransaction(ctx context.Context, pool *pgxpool.Pool, txID string) ([]LedgerEntry, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, transaction_id, currency, amount, direction, asset_id, liability_id, expense_id, revenue_id
		 FROM ledger_entries WHERE transaction_id = $1 ORDER BY id`, txID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []LedgerEntry
	for rows.Next() {
		var e LedgerEntry
		if err := rows.Scan(&e.ID, &e.TransactionID, &e.Currency, &e.Amount, &e.Direction,
			&e.AssetID, &e.LiabilityID, &e.ExpenseID, &e.RevenueID); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func GetLiabilityBalance(ctx context.Context, pool *pgxpool.Pool, liabilityID, currency string) (int64, error) {
	var balance int64
	err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(
			CASE direction
				WHEN 'CREDIT' THEN amount
				WHEN 'DEBIT'  THEN -amount
			END
		), 0)
		FROM ledger_entries
		WHERE liability_id = $1 AND currency = $2`,
		liabilityID, currency,
	).Scan(&balance)
	return balance, err
}
