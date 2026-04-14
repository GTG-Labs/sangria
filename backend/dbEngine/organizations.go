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

// ListOrganizationMembers returns all members of an organization with their admin status.
func ListOrganizationMembers(ctx context.Context, pool *pgxpool.Pool, organizationID string) ([]OrganizationMember, error) {
	rows, err := pool.Query(ctx,
		`SELECT user_id, organization_id, is_admin, joined_at
		 FROM organization_members
		 WHERE organization_id = $1
		 ORDER BY joined_at ASC`,
		organizationID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []OrganizationMember
	for rows.Next() {
		var m OrganizationMember
		if err := rows.Scan(&m.UserID, &m.OrganizationID, &m.IsAdmin, &m.JoinedAt); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return members, rows.Err()
}
