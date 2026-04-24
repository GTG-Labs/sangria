package dbengine

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors for better error handling
var (
	ErrInvitationNotFound = errors.New("invitation not found")
	ErrMemberNotFound     = errors.New("user not found in organization")
)

// ================================
// Organization Management
// ================================

// CreateOrganization creates a new organization and adds the creator as an admin
func CreateOrganization(ctx context.Context, pool *pgxpool.Pool, creatorUserID, orgName string) (string, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Create the organization
	var orgID string
	err = tx.QueryRow(ctx,
		`INSERT INTO organizations (name, is_personal, created_at)
		 VALUES ($1, false, NOW())
		 RETURNING id`,
		orgName,
	).Scan(&orgID)
	if err != nil {
		return "", fmt.Errorf("failed to create organization: %w", err)
	}

	// Add the creator as an admin of the new organization
	err = AddUserToOrganizationTx(ctx, tx, creatorUserID, orgID, true)
	if err != nil {
		return "", fmt.Errorf("failed to add creator to organization: %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("failed to commit transaction: %w", err)
	}

	return orgID, nil
}

// GetOrganization retrieves organization details by ID
func GetOrganization(ctx context.Context, pool *pgxpool.Pool, organizationID string) (*Organization, error) {
	var org Organization
	err := pool.QueryRow(ctx, `
		SELECT id, name, is_personal, created_at
		FROM organizations
		WHERE id = $1
	`, organizationID).Scan(&org.ID, &org.Name, &org.IsPersonal, &org.CreatedAt)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("organization not found: %s", organizationID)
		}
		return nil, fmt.Errorf("failed to get organization: %w", err)
	}

	return &org, nil
}

// ================================
// Organization Membership
// ================================

// AddUserToOrganization adds a user to an organization with specified admin status
func AddUserToOrganization(ctx context.Context, pool *pgxpool.Pool, userID, organizationID string, isAdmin bool) error {
	_, err := pool.Exec(ctx,
		`INSERT INTO organization_members (user_id, organization_id, is_admin, joined_at)
		 VALUES ($1, $2, $3, NOW())
		 ON CONFLICT (user_id, organization_id) DO UPDATE
		 	SET is_admin = organization_members.is_admin OR EXCLUDED.is_admin`,
		userID, organizationID, isAdmin,
	)
	return err
}

// AddUserToOrganizationTx adds a user to an organization within an existing transaction.
func AddUserToOrganizationTx(ctx context.Context, tx pgx.Tx, userID, organizationID string, isAdmin bool) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO organization_members (user_id, organization_id, is_admin, joined_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (user_id, organization_id) DO UPDATE
			SET is_admin = organization_members.is_admin OR EXCLUDED.is_admin`,
		userID, organizationID, isAdmin,
	)
	return err
}

// RemoveOrganizationMemberAsAdmin atomically removes a member from an organization,
// but only if the requesting user is an admin of that organization.
// Returns ErrMemberNotFound if the member doesn't exist or the admin check fails.
func RemoveOrganizationMemberAsAdmin(ctx context.Context, pool *pgxpool.Pool, memberUserID, organizationID, adminUserID string) (int64, error) {
	result, err := pool.Exec(ctx,
		`DELETE FROM organization_members
		 WHERE user_id = $1 AND organization_id = $2
		   AND EXISTS (
		     SELECT 1 FROM organization_members
		     WHERE user_id = $3 AND organization_id = $2 AND is_admin = true
		   )`,
		memberUserID, organizationID, adminUserID,
	)
	if err != nil {
		return 0, fmt.Errorf("failed to remove member from organization: %w", err)
	}
	return result.RowsAffected(), nil
}

// RemoveUserFromOrganization removes a user from an organization.
func RemoveUserFromOrganization(ctx context.Context, pool *pgxpool.Pool, userID, organizationID string) error {
	result, err := pool.Exec(ctx,
		`DELETE FROM organization_members WHERE user_id = $1 AND organization_id = $2`,
		userID, organizationID,
	)
	if err != nil {
		return fmt.Errorf("failed to remove user from organization: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrMemberNotFound
	}
	return nil
}

// ListOrganizationMembers returns all members of an organization.
func ListOrganizationMembers(ctx context.Context, pool *pgxpool.Pool, organizationID string) ([]OrganizationMember, error) {
	rows, err := pool.Query(ctx, `
		SELECT om.user_id, om.organization_id, om.is_admin, om.joined_at, u.owner
		FROM organization_members om
		JOIN users u ON u.workos_id = om.user_id
		WHERE om.organization_id = $1
		ORDER BY om.joined_at DESC`,
		organizationID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query organization members: %w", err)
	}
	defer rows.Close()

	var members []OrganizationMember
	for rows.Next() {
		var member OrganizationMember
		if err := rows.Scan(
			&member.UserID, &member.OrganizationID, &member.IsAdmin, &member.JoinedAt, &member.DisplayName,
		); err != nil {
			return nil, fmt.Errorf("failed to scan organization member: %w", err)
		}
		members = append(members, member)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("querying organization members: %w", err)
	}
	return members, nil
}

// GetUserOrganizations returns all organizations for a user with their admin status.
func GetUserOrganizations(ctx context.Context, pool *pgxpool.Pool, userID string) ([]OrganizationMember, error) {
	rows, err := pool.Query(ctx,
		`SELECT user_id, organization_id, is_admin, joined_at
		 FROM organization_members
		 WHERE user_id = $1
		 ORDER BY joined_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get user organizations: %w", err)
	}
	defer rows.Close()

	var organizations []OrganizationMember
	for rows.Next() {
		var org OrganizationMember
		if err := rows.Scan(&org.UserID, &org.OrganizationID, &org.IsAdmin, &org.JoinedAt); err != nil {
			return nil, fmt.Errorf("failed to scan organization: %w", err)
		}
		organizations = append(organizations, org)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration error: %w", err)
	}

	return organizations, nil
}

// GetUserOrganizationsWithDetails returns all organizations for a user with org name and personal flag included.
func GetUserOrganizationsWithDetails(ctx context.Context, pool *pgxpool.Pool, userID string) ([]UserOrganization, error) {
	rows, err := pool.Query(ctx,
		`SELECT o.id, o.name, o.is_personal, om.is_admin
		 FROM organization_members om
		 JOIN organizations o ON o.id = om.organization_id
		 WHERE om.user_id = $1
		 ORDER BY om.joined_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get user organizations with details: %w", err)
	}
	defer rows.Close()

	var orgs []UserOrganization
	for rows.Next() {
		var org UserOrganization
		if err := rows.Scan(&org.ID, &org.Name, &org.IsPersonal, &org.IsAdmin); err != nil {
			return nil, fmt.Errorf("failed to scan organization: %w", err)
		}
		orgs = append(orgs, org)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration error: %w", err)
	}

	return orgs, nil
}

// IsOrganizationMember returns true if the given user belongs to the specified organization.
func IsOrganizationMember(ctx context.Context, pool *pgxpool.Pool, userID, organizationID string) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM organization_members
		 WHERE user_id = $1 AND organization_id = $2)`,
		userID, organizationID,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
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

// ================================
// Organization Invitations
// ================================

// CreateInvitation creates a new organization invitation with a secure token
func CreateInvitation(ctx context.Context, pool *pgxpool.Pool, orgID, inviterUserID, inviteeEmail, message, token string) (string, error) {
	var invitationID string
	err := pool.QueryRow(ctx, `
		INSERT INTO organization_invitations
		(organization_id, inviter_user_id, invitee_email, message, invitation_token, expires_at)
		VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')
		RETURNING id`,
		orgID, inviterUserID, inviteeEmail, message, token,
	).Scan(&invitationID)

	if err != nil {
		return "", fmt.Errorf("failed to create invitation: %w", err)
	}

	return invitationID, nil
}

// CreateInvitationWithAdminCheck creates a new organization invitation with atomic admin verification.
// This prevents TOCTOU vulnerabilities by checking admin status in the same transaction as the insert.
func CreateInvitationWithAdminCheck(ctx context.Context, pool *pgxpool.Pool, orgID, inviterUserID, inviteeEmail, message, token string) (string, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Verify the inviter is an admin of the organization atomically
	var isAdmin bool
	err = tx.QueryRow(ctx, `
		SELECT is_admin FROM organization_members
		WHERE user_id = $1 AND organization_id = $2`,
		inviterUserID, orgID,
	).Scan(&isAdmin)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("user is not a member of the organization")
		}
		return "", fmt.Errorf("failed to verify admin status: %w", err)
	}

	if !isAdmin {
		return "", fmt.Errorf("user is not an admin of the organization")
	}

	// Create the invitation in the same transaction
	var invitationID string
	err = tx.QueryRow(ctx, `
		INSERT INTO organization_invitations
		(organization_id, inviter_user_id, invitee_email, message, invitation_token, expires_at)
		VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')
		RETURNING id`,
		orgID, inviterUserID, inviteeEmail, message, token,
	).Scan(&invitationID)

	if err != nil {
		return "", fmt.Errorf("failed to create invitation: %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("failed to commit transaction: %w", err)
	}

	return invitationID, nil
}

// GetInvitationByToken retrieves an invitation by its token
func GetInvitationByToken(ctx context.Context, pool *pgxpool.Pool, token string) (*OrganizationInvitation, error) {
	var invitation OrganizationInvitation
	err := pool.QueryRow(ctx, `
		SELECT id, organization_id, inviter_user_id, invitee_email, invitee_user_id,
		       status, message, invitation_token, expires_at, created_at, accepted_at, declined_at
		FROM organization_invitations
		WHERE invitation_token = $1`,
		token,
	).Scan(
		&invitation.ID, &invitation.OrganizationID, &invitation.InviterUserID,
		&invitation.InviteeEmail, &invitation.InviteeUserID, &invitation.Status,
		&invitation.Message, &invitation.InvitationToken, &invitation.ExpiresAt,
		&invitation.CreatedAt, &invitation.AcceptedAt, &invitation.DeclinedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("invitation not found: %w", ErrInvitationNotFound)
		}
		return nil, fmt.Errorf("failed to get invitation: %w", err)
	}

	return &invitation, nil
}

// MarkInvitationAccepted marks an invitation as accepted without creating a user
func MarkInvitationAccepted(ctx context.Context, pool *pgxpool.Pool, token string) error {
	_, err := pool.Exec(ctx, `
		UPDATE organization_invitations
		SET status = 'accepted', accepted_at = NOW()
		WHERE invitation_token = $1`,
		token,
	)
	return err
}

// DeleteInvitation deletes an invitation by ID (for cleanup on email send failure)
func DeleteInvitation(ctx context.Context, pool *pgxpool.Pool, invitationID string) error {
	_, err := pool.Exec(ctx, `
		DELETE FROM organization_invitations
		WHERE id = $1`,
		invitationID,
	)
	return err
}

// ProcessAcceptedInvitations checks for accepted invitations for this user and adds them to organizations
//
// SAFETY NET: This function serves as a backup processing mechanism for invitations that were
// marked as "accepted" but not fully processed. This can happen in the following scenarios:
//   1. Legacy invitations accepted before the unified AcceptOrganizationInvitation flow
//   2. WorkOS webhook processing where invitations are marked accepted externally
//   3. Recovery from failed transactions in AcceptOrganizationInvitation
//   4. Data consistency issues where invitation status and organization membership got out of sync
//
// In normal operation, AcceptOrganizationInvitation now handles the complete flow atomically,
// but this function ensures no accepted invitations are left unprocessed.
func ProcessAcceptedInvitations(ctx context.Context, pool *pgxpool.Pool, userID, userEmail string) error {
	// Normalize user email to match invitation creation normalization
	userEmail = strings.TrimSpace(strings.ToLower(userEmail))

	// Find all accepted invitations for this email that haven't been processed
	rows, err := pool.Query(ctx, `
		SELECT organization_id, id
		FROM organization_invitations
		WHERE invitee_email = $1 AND status = 'accepted' AND invitee_user_id IS NULL`,
		userEmail,
	)
	if err != nil {
		return fmt.Errorf("failed to query accepted invitations: %w", err)
	}
	defer rows.Close()

	var processedCount int
	var invitations []struct {
		orgID        string
		invitationID string
	}

	// Collect all invitations first
	for rows.Next() {
		var orgID, invitationID string
		if err := rows.Scan(&orgID, &invitationID); err != nil {
			return fmt.Errorf("failed to scan invitation: %w", err)
		}
		invitations = append(invitations, struct {
			orgID        string
			invitationID string
		}{orgID, invitationID})
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("reading invitations: %w", err)
	}

	// Process each invitation without transactions to avoid connection conflicts
	for _, inv := range invitations {
		processedCount++

		// Add user to organization
		err = AddUserToOrganization(ctx, pool, userID, inv.orgID, false)
		if err != nil {
			slog.Error("failed to add user to organization",
				"user_id", userID,
				"org_id", inv.orgID,
				"invitation_id", inv.invitationID,
				"error", err)
			continue // Continue with other invitations
		}

		// Mark invitation as fully processed
		_, err = pool.Exec(ctx, `
			UPDATE organization_invitations
			SET invitee_user_id = $1
			WHERE id = $2`,
			userID, inv.invitationID,
		)
		if err != nil {
			slog.Error("failed to update invitation",
				"invitation_id", inv.invitationID,
				"user_id", userID,
				"error", err)
			continue // Continue with other invitations
		}

		slog.Info("Processed accepted invitation",
			"user_id", userID,
			"organization_id", inv.orgID,
			"invitation_id", inv.invitationID,
		)
	}

	return nil
}