package dbengine

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// UpsertUser creates or updates a user (WorkOS identity) and returns the full row.
func UpsertUser(ctx context.Context, pool *pgxpool.Pool, owner, workosID string) (User, error) {
	var u User
	err := pool.QueryRow(ctx,
		`INSERT INTO users (owner, workos_id)
		 VALUES ($1, $2)
		 ON CONFLICT (workos_id) DO UPDATE
		 	SET owner = EXCLUDED.owner
		 RETURNING workos_id, owner, created_at, updated_at`,
		owner, workosID,
	).Scan(&u.WorkosID, &u.Owner, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}

// GetUserByWorkosID returns a user by their WorkOS ID.
func GetUserByWorkosID(ctx context.Context, pool *pgxpool.Pool, workosID string) (User, error) {
	var u User
	err := pool.QueryRow(ctx,
		`SELECT workos_id, owner, created_at, updated_at
		 FROM users WHERE workos_id = $1`,
		workosID,
	).Scan(&u.WorkosID, &u.Owner, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}
