package dbengine

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

func CreateAsset(ctx context.Context, pool *pgxpool.Pool, name string, currency Currency) (Asset, error) {
	var a Asset
	err := pool.QueryRow(ctx,
		`INSERT INTO assets (name, currency)
		 VALUES ($1, $2)
		 RETURNING id, name, currency, created_at`,
		name, currency,
	).Scan(&a.ID, &a.Name, &a.Currency, &a.CreatedAt)
	return a, err
}

func CreateLiability(ctx context.Context, pool *pgxpool.Pool, name string, currency Currency, userID string) (Liability, error) {
	var l Liability
	err := pool.QueryRow(ctx,
		`INSERT INTO liabilities (name, currency, user_id)
		 VALUES ($1, $2, $3)
		 RETURNING id, name, currency, user_id, created_at`,
		name, currency, userID,
	).Scan(&l.ID, &l.Name, &l.Currency, &l.UserID, &l.CreatedAt)
	return l, err
}

func CreateExpense(ctx context.Context, pool *pgxpool.Pool, name string, currency Currency) (Expense, error) {
	var e Expense
	err := pool.QueryRow(ctx,
		`INSERT INTO expenses (name, currency)
		 VALUES ($1, $2)
		 RETURNING id, name, currency, created_at`,
		name, currency,
	).Scan(&e.ID, &e.Name, &e.Currency, &e.CreatedAt)
	return e, err
}

func CreateRevenue(ctx context.Context, pool *pgxpool.Pool, name string, currency Currency) (Revenue, error) {
	var r Revenue
	err := pool.QueryRow(ctx,
		`INSERT INTO revenues (name, currency)
		 VALUES ($1, $2)
		 RETURNING id, name, currency, created_at`,
		name, currency,
	).Scan(&r.ID, &r.Name, &r.Currency, &r.CreatedAt)
	return r, err
}
