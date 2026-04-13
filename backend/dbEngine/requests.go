package dbengine

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrRequestNotFound is returned when a request does not exist.
var ErrRequestNotFound = errors.New("request not found")

// ErrDuplicateRequest is returned when a duplicate pending request exists.
var ErrDuplicateRequest = errors.New("duplicate pending request exists")

// ErrInvalidRequestStatus is returned when trying to perform an invalid status transition.
var ErrInvalidRequestStatus = errors.New("invalid request status transition")

// ---------------------------------------------------------------------------
// Organization Joining Requests
// ---------------------------------------------------------------------------

// CreateOrganizationJoiningRequest creates a new request for a user to join an organization.
// Prevents duplicate pending requests from the same user to the same organization.
func CreateOrganizationJoiningRequest(ctx context.Context, pool *pgxpool.Pool, requesterUserID, targetOrganizationID string, message *string) (OrganizationJoiningRequest, error) {
	var req OrganizationJoiningRequest

	err := pool.QueryRow(ctx, `
		INSERT INTO organization_joining_requests (requester_user_id, target_organization_id, message)
		VALUES ($1, $2, $3)
		RETURNING id, requester_user_id, target_organization_id, message, status,
		          reviewed_by, reviewed_at, review_note, created_at,
		          approved_at, rejected_at, canceled_at`,
		requesterUserID, targetOrganizationID, message,
	).Scan(
		&req.ID, &req.RequesterUserID, &req.TargetOrganizationID, &req.Message, &req.Status,
		&req.ReviewedBy, &req.ReviewedAt, &req.ReviewNote, &req.CreatedAt,
		&req.ApprovedAt, &req.RejectedAt, &req.CanceledAt,
	)

	if err != nil {
		// Check for unique constraint violation (duplicate pending request)
		if pgErr, ok := err.(*pgx.PgError); ok && pgErr.Code == "23505" {
			return OrganizationJoiningRequest{}, ErrDuplicateRequest
		}
		return OrganizationJoiningRequest{}, fmt.Errorf("failed to create organization joining request: %w", err)
	}

	return req, nil
}

// GetOrganizationJoiningRequest retrieves a joining request by its ID.
func GetOrganizationJoiningRequest(ctx context.Context, pool *pgxpool.Pool, requestID string) (OrganizationJoiningRequest, error) {
	var req OrganizationJoiningRequest

	err := pool.QueryRow(ctx, `
		SELECT id, requester_user_id, target_organization_id, message, status,
		       reviewed_by, reviewed_at, review_note, created_at,
		       approved_at, rejected_at, canceled_at
		FROM organization_joining_requests WHERE id = $1`,
		requestID,
	).Scan(
		&req.ID, &req.RequesterUserID, &req.TargetOrganizationID, &req.Message, &req.Status,
		&req.ReviewedBy, &req.ReviewedAt, &req.ReviewNote, &req.CreatedAt,
		&req.ApprovedAt, &req.RejectedAt, &req.CanceledAt,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return OrganizationJoiningRequest{}, ErrRequestNotFound
	}

	return req, err
}

// ListPendingJoiningRequestsForOrganization returns all pending join requests for an organization.
func ListPendingJoiningRequestsForOrganization(ctx context.Context, pool *pgxpool.Pool, organizationID string) ([]OrganizationJoiningRequest, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, requester_user_id, target_organization_id, message, status,
		       reviewed_by, reviewed_at, review_note, created_at,
		       approved_at, rejected_at, canceled_at
		FROM organization_joining_requests
		WHERE target_organization_id = $1 AND status = 'pending'
		ORDER BY created_at ASC`,
		organizationID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query pending joining requests: %w", err)
	}
	defer rows.Close()

	var requests []OrganizationJoiningRequest
	for rows.Next() {
		var req OrganizationJoiningRequest
		if err := rows.Scan(
			&req.ID, &req.RequesterUserID, &req.TargetOrganizationID, &req.Message, &req.Status,
			&req.ReviewedBy, &req.ReviewedAt, &req.ReviewNote, &req.CreatedAt,
			&req.ApprovedAt, &req.RejectedAt, &req.CanceledAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan joining request: %w", err)
		}
		requests = append(requests, req)
	}

	return requests, rows.Err()
}

// ApproveOrganizationJoiningRequest approves a pending join request and adds the user to the organization.
func ApproveOrganizationJoiningRequest(ctx context.Context, pool *pgxpool.Pool, requestID, reviewerUserID string, reviewNote *string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Get the request details and lock it
	var req OrganizationJoiningRequest
	err = tx.QueryRow(ctx, `
		SELECT id, requester_user_id, target_organization_id, status
		FROM organization_joining_requests
		WHERE id = $1 FOR UPDATE`,
		requestID,
	).Scan(&req.ID, &req.RequesterUserID, &req.TargetOrganizationID, &req.Status)

	if errors.Is(err, pgx.ErrNoRows) {
		return ErrRequestNotFound
	}
	if err != nil {
		return fmt.Errorf("failed to lock request: %w", err)
	}

	if req.Status != RequestStatusPending {
		return ErrInvalidRequestStatus
	}

	// Add user to organization as non-admin member
	err = AddUserToOrganizationTx(ctx, tx, req.RequesterUserID, req.TargetOrganizationID, false)
	if err != nil {
		return fmt.Errorf("failed to add user to organization: %w", err)
	}

	// Update request status
	_, err = tx.Exec(ctx, `
		UPDATE organization_joining_requests
		SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(),
		    review_note = $2, approved_at = NOW()
		WHERE id = $3`,
		reviewerUserID, reviewNote, requestID,
	)
	if err != nil {
		return fmt.Errorf("failed to update request status: %w", err)
	}

	return tx.Commit(ctx)
}

// RejectOrganizationJoiningRequest rejects a pending join request.
func RejectOrganizationJoiningRequest(ctx context.Context, pool *pgxpool.Pool, requestID, reviewerUserID string, reviewNote *string) error {
	result, err := pool.Exec(ctx, `
		UPDATE organization_joining_requests
		SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(),
		    review_note = $2, rejected_at = NOW()
		WHERE id = $3 AND status = 'pending'`,
		reviewerUserID, reviewNote, requestID,
	)
	if err != nil {
		return fmt.Errorf("failed to reject request: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrRequestNotFound
	}
	return nil
}

// ---------------------------------------------------------------------------
// API Key Creation Requests
// ---------------------------------------------------------------------------

// CreateAPIKeyCreationRequest creates a new request for an API key within an organization.
func CreateAPIKeyCreationRequest(ctx context.Context, pool *pgxpool.Pool, requesterUserID, organizationID, keyName, justification string) (APIKeyCreationRequest, error) {
	var req APIKeyCreationRequest

	err := pool.QueryRow(ctx, `
		INSERT INTO api_key_creation_requests (requester_user_id, organization_id, requested_key_name, justification)
		VALUES ($1, $2, $3, $4)
		RETURNING id, requester_user_id, organization_id, requested_key_name, justification, status,
		          reviewed_by, reviewed_at, review_note, merchant_id, created_at,
		          approved_at, rejected_at, canceled_at`,
		requesterUserID, organizationID, keyName, justification,
	).Scan(
		&req.ID, &req.RequesterUserID, &req.OrganizationID, &req.RequestedKeyName, &req.Justification, &req.Status,
		&req.ReviewedBy, &req.ReviewedAt, &req.ReviewNote, &req.MerchantID, &req.CreatedAt,
		&req.ApprovedAt, &req.RejectedAt, &req.CanceledAt,
	)

	if err != nil {
		return APIKeyCreationRequest{}, fmt.Errorf("failed to create API key creation request: %w", err)
	}

	return req, nil
}

// ListPendingAPIKeyRequestsForOrganization returns all pending API key requests for an organization.
func ListPendingAPIKeyRequestsForOrganization(ctx context.Context, pool *pgxpool.Pool, organizationID string) ([]APIKeyCreationRequest, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, requester_user_id, organization_id, requested_key_name, justification, status,
		       reviewed_by, reviewed_at, review_note, merchant_id, created_at,
		       approved_at, rejected_at, canceled_at
		FROM api_key_creation_requests
		WHERE organization_id = $1 AND status = 'pending'
		ORDER BY created_at ASC`,
		organizationID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query pending API key requests: %w", err)
	}
	defer rows.Close()

	var requests []APIKeyCreationRequest
	for rows.Next() {
		var req APIKeyCreationRequest
		if err := rows.Scan(
			&req.ID, &req.RequesterUserID, &req.OrganizationID, &req.RequestedKeyName, &req.Justification, &req.Status,
			&req.ReviewedBy, &req.ReviewedAt, &req.ReviewNote, &req.MerchantID, &req.CreatedAt,
			&req.ApprovedAt, &req.RejectedAt, &req.CanceledAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan API key request: %w", err)
		}
		requests = append(requests, req)
	}

	return requests, rows.Err()
}

// ApproveAPIKeyCreationRequest approves a pending API key request and creates the actual API key.
func ApproveAPIKeyCreationRequest(ctx context.Context, pool *pgxpool.Pool, requestID, reviewerUserID string, reviewNote *string) (Merchant, string, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Merchant{}, "", fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Get the request details and lock it
	var req APIKeyCreationRequest
	err = tx.QueryRow(ctx, `
		SELECT id, requester_user_id, organization_id, requested_key_name, status
		FROM api_key_creation_requests
		WHERE id = $1 FOR UPDATE`,
		requestID,
	).Scan(&req.ID, &req.RequesterUserID, &req.OrganizationID, &req.RequestedKeyName, &req.Status)

	if errors.Is(err, pgx.ErrNoRows) {
		return Merchant{}, "", ErrRequestNotFound
	}
	if err != nil {
		return Merchant{}, "", fmt.Errorf("failed to lock request: %w", err)
	}

	if req.Status != RequestStatusPending {
		return Merchant{}, "", ErrInvalidRequestStatus
	}

	// Create the API key using the existing CreateAPIKey logic (but we need to adapt it for organization context)
	// For now, we'll create a placeholder - this needs to be integrated with the auth/keyStore.go CreateAPIKey function

	// TODO: Integrate with auth/keyStore.CreateAPIKey function once organization context is implemented
	// merchant, fullKey, err := auth.CreateAPIKey(ctx, tx, req.OrganizationID, req.RequestedKeyName)

	// PLACEHOLDER: Update request status for now
	_, err = tx.Exec(ctx, `
		UPDATE api_key_creation_requests
		SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(),
		    review_note = $2, approved_at = NOW()
		WHERE id = $3`,
		reviewerUserID, reviewNote, requestID,
	)
	if err != nil {
		return Merchant{}, "", fmt.Errorf("failed to update request status: %w", err)
	}

	err = tx.Commit(ctx)
	if err != nil {
		return Merchant{}, "", fmt.Errorf("failed to commit transaction: %w", err)
	}

	// Return placeholder values until integration is complete
	return Merchant{}, "", fmt.Errorf("API key creation integration not yet complete")
}

// AddUserToOrganizationTx adds a user to an organization within an existing transaction.
func AddUserToOrganizationTx(ctx context.Context, tx pgx.Tx, userID, organizationID string, isAdmin bool) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO organization_members (user_id, organization_id, is_admin)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, organization_id) DO UPDATE
			SET is_admin = EXCLUDED.is_admin,
			    joined_at = NOW()`,
		userID, organizationID, isAdmin,
	)
	return err
}