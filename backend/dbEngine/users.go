package dbengine

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UpsertUser creates or updates a user (WorkOS identity) and returns the full row.
func UpsertUser(ctx context.Context, pool *pgxpool.Pool, owner, workosID string) (User, error) {
	var u User
	err := pool.QueryRow(ctx,
		`INSERT INTO users (workos_id, owner)
		 VALUES ($1, $2)
		 ON CONFLICT (workos_id) DO UPDATE
		 	SET owner = EXCLUDED.owner,
		 	    updated_at = NOW()
		 RETURNING workos_id, owner, created_at, updated_at`,
		workosID, owner,
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

// AddUserToOrganization adds a user to an organization with specified admin status
func AddUserToOrganization(ctx context.Context, pool *pgxpool.Pool, userID, organizationID string, isAdmin bool) error {
	_, err := pool.Exec(ctx,
		`INSERT INTO organization_members (user_id, organization_id, is_admin, joined_at)
		 VALUES ($1, $2, $3, NOW())
		 ON CONFLICT (user_id, organization_id) DO UPDATE
		 	SET is_admin = EXCLUDED.is_admin`,
		userID, organizationID, isAdmin,
	)
	return err
}

// GetUserOrganizations returns all organizations for a user with their admin status
func GetUserOrganizations(ctx context.Context, pool *pgxpool.Pool, userID string) ([]OrganizationMember, error) {
	rows, err := pool.Query(ctx,
		`SELECT user_id, organization_id, is_admin, joined_at
		 FROM organization_members
		 WHERE user_id = $1
		 ORDER BY joined_at ASC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var memberships []OrganizationMember
	for rows.Next() {
		var m OrganizationMember
		if err := rows.Scan(&m.UserID, &m.OrganizationID, &m.IsAdmin, &m.JoinedAt); err != nil {
			return nil, err
		}
		memberships = append(memberships, m)
	}
	return memberships, rows.Err()
}

// IsAdmin returns true if the given WorkOS user ID has an entry in the admins table.
func IsAdmin(ctx context.Context, pool *pgxpool.Pool, workosID string) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM admins WHERE user_id = $1)`,
		workosID,
	).Scan(&exists)
	return exists, err
}

// IsOrganizationAdmin returns true if the given user is an admin of the specified organization.
func IsOrganizationAdmin(ctx context.Context, pool *pgxpool.Pool, userID, organizationID string) (bool, error) {
	var isAdmin bool
	err := pool.QueryRow(ctx,
		`SELECT is_admin FROM organization_members
		 WHERE user_id = $1 AND organization_id = $2`,
		userID, organizationID,
	).Scan(&isAdmin)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil // User is not a member of the organization
		}
		return false, err
	}
	return isAdmin, nil
}
