package dbengine

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrRequestNotFound is returned when a request does not exist.
var ErrRequestNotFound = errors.New("request not found")

// ErrInvalidRequestStatus is returned when trying to perform an invalid status transition.
var ErrInvalidRequestStatus = errors.New("invalid request status transition")

// ErrInvitationNotFound is returned when an invitation does not exist.
var ErrInvitationNotFound = errors.New("invitation not found")

// ErrDuplicateInvitation is returned when a duplicate pending invitation exists.
var ErrDuplicateInvitation = errors.New("duplicate pending invitation exists")

// ErrInvalidToken is returned when an invitation token is invalid or expired.
var ErrInvalidToken = errors.New("invalid or expired invitation token")

// ---------------------------------------------------------------------------
// Organization Invitations
// TODO: HTTP handlers and routes for these DB functions have not been implemented yet.
// See routes/jwt.go for the planned endpoints.
// ---------------------------------------------------------------------------

// generateInvitationToken creates a cryptographically secure random token for invitations.
func generateInvitationToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("failed to generate random token: %w", err)
	}
	return hex.EncodeToString(bytes), nil
}

// CreateOrganizationInvitation creates a new invitation for an email to join an organization.
// Prevents duplicate pending invitations to the same email for the same organization.
func CreateOrganizationInvitation(ctx context.Context, pool *pgxpool.Pool, organizationID, inviterUserID, inviteeEmail string, message *string) (OrganizationInvitation, error) {
	var invitation OrganizationInvitation

	// Generate secure invitation token
	token, err := generateInvitationToken()
	if err != nil {
		return OrganizationInvitation{}, fmt.Errorf("failed to generate invitation token: %w", err)
	}

	// Set expiration to 7 days from now
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	err = pool.QueryRow(ctx, `
		INSERT INTO organization_invitations (organization_id, inviter_user_id, invitee_email, message, invitation_token, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, organization_id, inviter_user_id, invitee_email, invitee_user_id, status,
		          message, invitation_token, expires_at, created_at, accepted_at, declined_at`,
		organizationID, inviterUserID, inviteeEmail, message, token, expiresAt,
	).Scan(
		&invitation.ID, &invitation.OrganizationID, &invitation.InviterUserID, &invitation.InviteeEmail,
		&invitation.InviteeUserID, &invitation.Status, &invitation.Message, &invitation.InvitationToken,
		&invitation.ExpiresAt, &invitation.CreatedAt, &invitation.AcceptedAt, &invitation.DeclinedAt,
	)

	if err != nil {
		// Check for unique constraint violation (duplicate pending invitation)
		if pgErr, ok := err.(*pgconn.PgError); ok && pgErr.Code == "23505" {
			return OrganizationInvitation{}, ErrDuplicateInvitation
		}
		return OrganizationInvitation{}, fmt.Errorf("failed to create organization invitation: %w", err)
	}

	return invitation, nil
}

// GetOrganizationInvitationByToken retrieves an invitation by its token.
func GetOrganizationInvitationByToken(ctx context.Context, pool *pgxpool.Pool, token string) (OrganizationInvitation, error) {
	var invitation OrganizationInvitation

	err := pool.QueryRow(ctx, `
		SELECT id, organization_id, inviter_user_id, invitee_email, invitee_user_id, status,
		       message, invitation_token, expires_at, created_at, accepted_at, declined_at
		FROM organization_invitations WHERE invitation_token = $1`,
		token,
	).Scan(
		&invitation.ID, &invitation.OrganizationID, &invitation.InviterUserID, &invitation.InviteeEmail,
		&invitation.InviteeUserID, &invitation.Status, &invitation.Message, &invitation.InvitationToken,
		&invitation.ExpiresAt, &invitation.CreatedAt, &invitation.AcceptedAt, &invitation.DeclinedAt,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return OrganizationInvitation{}, ErrInvitationNotFound
	}
	if err != nil {
		return OrganizationInvitation{}, fmt.Errorf("fetching organization invitation by token: %w", err)
	}

	return invitation, nil
}

// GetOrganizationInvitation retrieves an invitation by its ID.
func GetOrganizationInvitation(ctx context.Context, pool *pgxpool.Pool, invitationID string) (OrganizationInvitation, error) {
	var invitation OrganizationInvitation

	err := pool.QueryRow(ctx, `
		SELECT id, organization_id, inviter_user_id, invitee_email, invitee_user_id, status,
		       message, invitation_token, expires_at, created_at, accepted_at, declined_at
		FROM organization_invitations WHERE id = $1`,
		invitationID,
	).Scan(
		&invitation.ID, &invitation.OrganizationID, &invitation.InviterUserID, &invitation.InviteeEmail,
		&invitation.InviteeUserID, &invitation.Status, &invitation.Message, &invitation.InvitationToken,
		&invitation.ExpiresAt, &invitation.CreatedAt, &invitation.AcceptedAt, &invitation.DeclinedAt,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return OrganizationInvitation{}, ErrInvitationNotFound
	}
	if err != nil {
		return OrganizationInvitation{}, fmt.Errorf("fetching organization invitation by ID: %w", err)
	}

	return invitation, nil
}

// ListPendingInvitationsForOrganization returns all pending invitations for an organization.
func ListPendingInvitationsForOrganization(ctx context.Context, pool *pgxpool.Pool, organizationID string) ([]OrganizationInvitation, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, organization_id, inviter_user_id, invitee_email, invitee_user_id, status,
		       message, invitation_token, expires_at, created_at, accepted_at, declined_at
		FROM organization_invitations
		WHERE organization_id = $1 AND status = 'pending' AND expires_at > NOW()
		ORDER BY created_at ASC`,
		organizationID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query pending invitations: %w", err)
	}
	defer rows.Close()

	var invitations []OrganizationInvitation
	for rows.Next() {
		var invitation OrganizationInvitation
		if err := rows.Scan(
			&invitation.ID, &invitation.OrganizationID, &invitation.InviterUserID, &invitation.InviteeEmail,
			&invitation.InviteeUserID, &invitation.Status, &invitation.Message, &invitation.InvitationToken,
			&invitation.ExpiresAt, &invitation.CreatedAt, &invitation.AcceptedAt, &invitation.DeclinedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan invitation: %w", err)
		}
		invitations = append(invitations, invitation)
	}

	return invitations, rows.Err()
}

// GetUserInvitations returns all invitations for a specific user email.
func GetUserInvitations(ctx context.Context, pool *pgxpool.Pool, email string) ([]OrganizationInvitation, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, organization_id, inviter_user_id, invitee_email, invitee_user_id, status,
		       message, invitation_token, expires_at, created_at, accepted_at, declined_at
		FROM organization_invitations
		WHERE invitee_email = $1
		ORDER BY created_at DESC`,
		email,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query user invitations: %w", err)
	}
	defer rows.Close()

	var invitations []OrganizationInvitation
	for rows.Next() {
		var invitation OrganizationInvitation
		if err := rows.Scan(
			&invitation.ID, &invitation.OrganizationID, &invitation.InviterUserID, &invitation.InviteeEmail,
			&invitation.InviteeUserID, &invitation.Status, &invitation.Message, &invitation.InvitationToken,
			&invitation.ExpiresAt, &invitation.CreatedAt, &invitation.AcceptedAt, &invitation.DeclinedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan invitation: %w", err)
		}
		invitations = append(invitations, invitation)
	}

	return invitations, rows.Err()
}

// AcceptInvitation accepts a pending invitation and adds the user to the organization.
func AcceptInvitation(ctx context.Context, pool *pgxpool.Pool, token, userID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Get the invitation details and lock it
	var invitation OrganizationInvitation
	err = tx.QueryRow(ctx, `
		SELECT id, organization_id, invitee_email, status, expires_at
		FROM organization_invitations
		WHERE invitation_token = $1 FOR UPDATE`,
		token,
	).Scan(&invitation.ID, &invitation.OrganizationID, &invitation.InviteeEmail, &invitation.Status, &invitation.ExpiresAt)

	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidToken
	}
	if err != nil {
		return fmt.Errorf("failed to lock invitation: %w", err)
	}

	// Check if invitation is still valid
	if invitation.Status != InvitationStatusPending {
		return ErrInvalidToken
	}
	if time.Now().After(invitation.ExpiresAt) {
		return ErrInvalidToken
	}

	// Add user to organization as non-admin member
	err = AddUserToOrganizationTx(ctx, tx, userID, invitation.OrganizationID, false)
	if err != nil {
		return fmt.Errorf("failed to add user to organization: %w", err)
	}

	// Update invitation status
	_, err = tx.Exec(ctx, `
		UPDATE organization_invitations
		SET status = 'accepted', invitee_user_id = $1, accepted_at = NOW()
		WHERE invitation_token = $2`,
		userID, token,
	)
	if err != nil {
		return fmt.Errorf("failed to update invitation status: %w", err)
	}

	return tx.Commit(ctx)
}

// DeclineInvitation declines a pending invitation.
func DeclineInvitation(ctx context.Context, pool *pgxpool.Pool, token string) error {
	result, err := pool.Exec(ctx, `
		UPDATE organization_invitations
		SET status = 'declined', declined_at = NOW()
		WHERE invitation_token = $1 AND status = 'pending' AND expires_at > NOW()`,
		token,
	)
	if err != nil {
		return fmt.Errorf("failed to decline invitation: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrInvalidToken
	}
	return nil
}

// CancelInvitation allows an admin to cancel a pending invitation.
func CancelInvitation(ctx context.Context, pool *pgxpool.Pool, invitationID string) error {
	result, err := pool.Exec(ctx, `
		UPDATE organization_invitations
		SET status = 'expired'
		WHERE id = $1 AND status = 'pending'`,
		invitationID,
	)
	if err != nil {
		return fmt.Errorf("failed to cancel invitation: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrInvitationNotFound
	}
	return nil
}

// ExpireOldInvitations marks invitations as expired if they're past their expiry date.
func ExpireOldInvitations(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	result, err := pool.Exec(ctx, `
		UPDATE organization_invitations
		SET status = 'expired'
		WHERE status = 'pending' AND expires_at <= NOW()`)
	if err != nil {
		return 0, fmt.Errorf("failed to expire old invitations: %w", err)
	}
	return int(result.RowsAffected()), nil
}


// AddUserToOrganizationTx adds a user to an organization within an existing transaction.
func AddUserToOrganizationTx(ctx context.Context, tx pgx.Tx, userID, organizationID string, isAdmin bool) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO organization_members (user_id, organization_id, is_admin, joined_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (user_id, organization_id) DO UPDATE
			SET is_admin = EXCLUDED.is_admin`,
		userID, organizationID, isAdmin,
	)
	return err
}