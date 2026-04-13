package adminHandlers

import (
	"errors"
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/auth"
	dbengine "sangria/backend/dbEngine"
)

// CreateMerchantAPIKey handles POST /merchants.
// Creates a merchant API key and USDC LIABILITY account for a user (admin-only, WorkOS JWT auth).
func CreateMerchantAPIKey(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		// Get authenticated user from middleware context
		user, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		var req struct {
			Name string `json:"name"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		if req.Name == "" {
			return c.Status(400).JSON(fiber.Map{"error": "name is required"})
		}

		// Ensure the user exists in the database first
		owner := user.Email
		if user.FirstName != "" && user.LastName != "" {
			owner = user.FirstName + " " + user.LastName
		}
		if _, err := dbengine.UpsertUser(c.Context(), pool, owner, user.ID); err != nil {
			slog.Error("upsert user", "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create user"})
		}

		// TEMPORARY: Return not implemented until CreateAPIKey is updated for org context
		// TODO: Remove this early return and implement the organization logic below
		slog.Warn("CreateMerchantAPIKey: CreateAPIKey not updated for organization context", "user_id", user.ID)
		return c.Status(501).JSON(fiber.Map{"error": "API key creation with organization context not implemented yet"})

		// TODO: This admin handler needs organization context implementation
		// Get user organizations and derive selectedOrgID appropriately
		memberships, err := dbengine.GetUserOrganizations(c.Context(), pool, user.ID)
		if err != nil {
			slog.Error("get user organizations", "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to get user organizations"})
		}
		if len(memberships) == 0 {
			slog.Error("user has no organizations", "user_id", user.ID)
			return c.Status(400).JSON(fiber.Map{"error": "user must belong to an organization"})
		}

		// Derive selectedOrgID from request or admin membership
		var selectedOrgID string

		// Check for organization_id in request query params
		if orgID := c.Query("organization_id"); orgID != "" {
			// Validate that user is a member of this organization
			found := false
			for _, membership := range memberships {
				if membership.OrganizationID == orgID {
					selectedOrgID = orgID
					found = true
					break
				}
			}
			if !found {
				return c.Status(400).JSON(fiber.Map{"error": "user is not a member of the specified organization"})
			}
		} else {
			// Find an admin membership
			for _, membership := range memberships {
				if membership.IsAdmin {
					selectedOrgID = membership.OrganizationID
					break
				}
			}
			// If no admin membership found and only one membership exists, use that
			if selectedOrgID == "" && len(memberships) == 1 {
				selectedOrgID = memberships[0].OrganizationID
			}
			// If still no org selected and multiple memberships exist, prompt for specification
			if selectedOrgID == "" {
				return c.Status(400).JSON(fiber.Map{"error": "multiple organizations found, please specify organization_id parameter"})
			}
		}

		// Ensure the organization has a USD LIABILITY account before creating the API key,
		// so we don't end up with an active key but no liability account.
		if _, err := dbengine.EnsureUSDLiabilityAccount(c.Context(), pool, selectedOrgID); err != nil {
			slog.Error("ensure USD liability account", "org_id", selectedOrgID, "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create liability account"})
		}

		// TODO: Update CreateAPIKey to use organization context
		// merchant, fullKey, err := auth.CreateAPIKey(c.Context(), pool, selectedOrgID, req.Name)

		// TODO: Restore this code when CreateAPIKey is updated for organization context
		// if err != nil {
		// 	if errors.Is(err, auth.ErrMaxAPIKeysReached) {
		// 		return c.Status(400).JSON(fiber.Map{"error": "maximum number of API keys reached (10)"})
		// 	}
		// 	slog.Error("create merchant API key", "user_id", user.ID, "error", err)
		// 	return c.Status(500).JSON(fiber.Map{"error": "failed to create merchant"})
		// }

		// TODO: Return merchant record + raw key (only shown once).
		// return c.Status(201).JSON(fiber.Map{
		// 	"id":         merchant.ID,
		// 	"organization_id": merchant.OrganizationID,
		// 	"name":       merchant.Name,
		// 	"key_id":     merchant.KeyID,
		// 	"api_key":    fullKey,
		// 	"is_active":  merchant.IsActive,
		// 	"created_at": merchant.CreatedAt,
		// })
	}
}
