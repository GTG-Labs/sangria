package dbengine

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CreateOrganization creates a new non-personal organization and adds the
// given user as its admin. Both operations run in a single transaction.
// Returns the new organization's ID.
func CreateOrganization(ctx context.Context, pool *pgxpool.Pool, userID, name string) (string, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var orgID string
	err = tx.QueryRow(ctx,
		`INSERT INTO organizations (name, is_personal, created_at)
		 VALUES ($1, false, NOW())
		 RETURNING id`,
		name,
	).Scan(&orgID)
	if err != nil {
		return "", fmt.Errorf("insert organization: %w", err)
	}

	if err := AddUserToOrganizationTx(ctx, tx, userID, orgID, true); err != nil {
		return "", fmt.Errorf("add user as admin: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit: %w", err)
	}

	return orgID, nil
}
