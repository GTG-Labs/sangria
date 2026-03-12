package dbengine

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

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
