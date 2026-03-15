package dbengine

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// CreateCard inserts a new card with a bcrypt-hashed API key.
// Returns the card record (with hash, not raw key). The caller is
// responsible for returning the raw key to the user exactly once.
func CreateCard(ctx context.Context, pool *pgxpool.Pool, userID, name, rawAPIKey string) (Card, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(rawAPIKey), bcrypt.DefaultCost)
	if err != nil {
		return Card{}, fmt.Errorf("hash api key: %w", err)
	}

	var c Card
	err = pool.QueryRow(ctx,
		`INSERT INTO cards (user_id, api_key, name)
		 VALUES ($1, $2, $3)
		 RETURNING id, user_id, api_key, name, is_active, last_used_at, created_at`,
		userID, string(hash), name,
	).Scan(&c.ID, &c.UserID, &c.ApiKey, &c.Name, &c.IsActive, &c.LastUsedAt, &c.CreatedAt)
	return c, err
}

// GetCardByID returns a card by its UUID.
func GetCardByID(ctx context.Context, pool *pgxpool.Pool, id string) (Card, error) {
	var c Card
	err := pool.QueryRow(ctx,
		`SELECT id, user_id, api_key, name, is_active, last_used_at, created_at
		 FROM cards WHERE id = $1`,
		id,
	).Scan(&c.ID, &c.UserID, &c.ApiKey, &c.Name, &c.IsActive, &c.LastUsedAt, &c.CreatedAt)
	return c, err
}

// TODO: API key lookup mechanism (bcrypt can't be used in WHERE clauses).
// Being handled separately — will need a prefix/identifier approach for O(1) lookup.
