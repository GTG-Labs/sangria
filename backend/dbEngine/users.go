package dbengine

import (
	"context"
	"errors"
	"fmt"

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

// UpsertUserTx creates or updates a user (WorkOS identity) within a transaction and returns the full row.
func UpsertUserTx(ctx context.Context, tx pgx.Tx, owner, workosID string) (User, error) {
	var u User
	err := tx.QueryRow(ctx,
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



// queryRowInterface defines the interface for executing a single-row query
type queryRowInterface interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// getUserPersonalOrgIDQuery is a helper that executes the personal org lookup query
func getUserPersonalOrgIDQuery(ctx context.Context, q queryRowInterface, userID string) (string, error) {
	var orgID string
	err := q.QueryRow(ctx,
		`SELECT o.id
		 FROM organizations o
		 JOIN organization_members om ON om.organization_id = o.id
		 WHERE om.user_id = $1 AND o.is_personal = true
		 LIMIT 1`,
		userID,
	).Scan(&orgID)
	return orgID, err
}

// GetUserPersonalOrgID returns the organization ID of the user's personal org, if one exists.
func GetUserPersonalOrgID(ctx context.Context, pool *pgxpool.Pool, userID string) (string, error) {
	return getUserPersonalOrgIDQuery(ctx, pool, userID)
}

// GetUserPersonalOrgIDTx returns the organization ID of the user's personal org within a transaction, if one exists.
func GetUserPersonalOrgIDTx(ctx context.Context, tx pgx.Tx, userID string) (string, error) {
	return getUserPersonalOrgIDQuery(ctx, tx, userID)
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

// EnsurePersonalOrganizationTx creates a personal organization for the user if one
// doesn't already exist. Must be called within an existing transaction. Acquires a
// row lock on the user to serialize concurrent signup flows.
func EnsurePersonalOrganizationTx(ctx context.Context, tx pgx.Tx, userWorkosID, userName string) error {
	// Acquire a row lock on the user to serialize concurrent flows
	var lockCheck bool
	err := tx.QueryRow(ctx,
		`SELECT true FROM users WHERE workos_id = $1 FOR UPDATE`,
		userWorkosID,
	).Scan(&lockCheck)
	if err != nil {
		return fmt.Errorf("failed to acquire user lock: %w", err)
	}

	// Check if user already has a personal organization
	_, err = GetUserPersonalOrgIDTx(ctx, tx, userWorkosID)
	if err == nil {
		// Personal org already exists, nothing to do
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("failed to check existing personal organization: %w", err)
	}

	// Create personal organization inside transaction
	var personalOrgID string
	personalOrgName := fmt.Sprintf("%s's Personal Organization", userName)

	err = tx.QueryRow(ctx,
		`INSERT INTO organizations (name, is_personal, created_at)
		 VALUES ($1, true, NOW())
		 RETURNING id`,
		personalOrgName,
	).Scan(&personalOrgID)
	if err != nil {
		return fmt.Errorf("failed to create personal organization: %w", err)
	}

	// Add user to their personal organization as admin
	err = AddUserToOrganizationTx(ctx, tx, userWorkosID, personalOrgID, true)
	if err != nil {
		return fmt.Errorf("failed to add user to personal organization: %w", err)
	}

	return nil
}

