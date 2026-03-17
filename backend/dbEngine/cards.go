package dbengine

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// GetCardByID returns a card by its UUID.
func GetCardByID(ctx context.Context, pool *pgxpool.Pool, id string) (Card, error) {
	var c Card
	err := pool.QueryRow(ctx,
		`SELECT id, user_id, api_key, key_id, name, is_active, last_used_at, created_at
		 FROM cards WHERE id = $1`,
		id,
	).Scan(&c.ID, &c.UserID, &c.APIKey, &c.KeyID, &c.Name, &c.IsActive, &c.LastUsedAt, &c.CreatedAt)
	return c, err
}

// TODO: Cards need their own API key generation scheme, separate from the
// merchant sg_live_/sg_test_ format. Implement card-specific key generation
// and a CreateCard function using it.
