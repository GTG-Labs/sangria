package auth

import (
	"context"
	"errors"
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangria/backend/dbEngine"
)

// OrganizationResolutionResult contains the result of organization resolution
type OrganizationResolutionResult struct {
	OrganizationID string
	HTTPStatus     int
	Error          string
	Memberships    []dbengine.OrganizationMember
}

// ResolveOrganizationContext resolves the organization context for a request.
// It handles the common pattern of:
// 1. Getting user organizations
// 2. Validating query parameters ("org_id" or "organization_id")
// 3. Falling back to single membership or personal org ID
// 4. Returning appropriate HTTP status codes and error messages
func ResolveOrganizationContext(ctx context.Context, c fiber.Ctx, pool *pgxpool.Pool, user WorkOSUser) OrganizationResolutionResult {
	// Get user's organizations
	memberships, err := dbengine.GetUserOrganizations(ctx, pool, user.ID)
	if err != nil {
		slog.Error("get user organizations", "user_id", user.ID, "error", err)
		return OrganizationResolutionResult{
			HTTPStatus: 500,
			Error:      "failed to get user organizations",
		}
	}
	if len(memberships) == 0 {
		slog.Error("user has no organizations", "user_id", user.ID)
		return OrganizationResolutionResult{
			HTTPStatus: 400,
			Error:      "user must belong to an organization",
		}
	}

	// Derive selectedOrgID from request or user's active selection
	var selectedOrgID string

	// Helper function to validate organization membership
	validateAndSelectOrg := func(queryVal string, memberships []dbengine.OrganizationMember) (selected string, ok bool) {
		for _, membership := range memberships {
			if membership.OrganizationID == queryVal {
				return queryVal, true
			}
		}
		return "", false
	}

	// Check for "org_id" parameter first
	if orgID := c.Query("org_id"); orgID != "" {
		if selected, found := validateAndSelectOrg(orgID, memberships); found {
			selectedOrgID = selected
		} else {
			return OrganizationResolutionResult{
				HTTPStatus: 400,
				Error:      "user is not a member of the specified organization",
			}
		}
	} else if orgID := c.Query("organization_id"); orgID != "" {
		// Also check for "organization_id" parameter
		if selected, found := validateAndSelectOrg(orgID, memberships); found {
			selectedOrgID = selected
		} else {
			return OrganizationResolutionResult{
				HTTPStatus: 400,
				Error:      "user is not a member of the specified organization",
			}
		}
	} else if len(memberships) == 1 {
		// If only one membership exists, use that
		selectedOrgID = memberships[0].OrganizationID
	} else {
		// Multiple organizations, try to get personal org ID
		personalOrgID, err := dbengine.GetUserPersonalOrgID(ctx, pool, user.ID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return OrganizationResolutionResult{
					HTTPStatus: 400,
					Error:      "multiple organizations found, please specify org_id or organization_id parameter",
				}
			}
			slog.Error("get user personal org ID", "user_id", user.ID, "error", err)
			return OrganizationResolutionResult{
				HTTPStatus: 500,
				Error:      "failed to get user personal organization: ",
			}
		}
		selectedOrgID = personalOrgID
	}

	return OrganizationResolutionResult{
		OrganizationID: selectedOrgID,
		HTTPStatus:     200,
		Error:          "",
		Memberships:    memberships,
	}
}