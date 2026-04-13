package merchantHandlers

import (
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/auth"
	dbengine "sangria/backend/dbEngine"
	"sangria/backend/utils"
)

// GetMerchantBalance handles GET /balance and returns the merchant's USD balance.
func GetMerchantBalance(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		// Get user's organizations to determine organization context
		memberships, err := dbengine.GetUserOrganizations(c.Context(), pool, user.ID)
		if err != nil {
			slog.Error("get user organizations", "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to get user organizations"})
		}
		if len(memberships) == 0 {
			slog.Error("user has no organizations", "user_id", user.ID)
			return c.Status(400).JSON(fiber.Map{"error": "user must belong to an organization"})
		}

		// Derive selectedOrgID from request or user's active selection
		var selectedOrgID string

		if orgID := c.Query("org_id"); orgID != "" {
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
		} else if orgID := c.Query("organization_id"); orgID != "" {
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
		} else if len(memberships) == 1 {
			selectedOrgID = memberships[0].OrganizationID
		} else {
			personalOrgID, err := dbengine.GetUserPersonalOrgID(c.Context(), pool, user.ID)
			if err != nil {
				return c.Status(400).JSON(fiber.Map{"error": "multiple organizations found, please specify org_id or organization_id parameter"})
			}
			selectedOrgID = personalOrgID
		}

		balance, err := dbengine.GetAccountBalance(c.Context(), pool, selectedOrgID)
		if err != nil {
			slog.Error("fetch balance: query failed", "user_id", user.ID, "org_id", selectedOrgID, "error", err)
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to retrieve balance",
			})
		}

		return c.JSON(fiber.Map{
			"balance":  balance,
			"currency": "USD",
		})
	}
}

// GetMerchantTransactions handles GET /transactions with cursor-based pagination
// Query params: ?limit=20&cursor=base64_encoded_timestamp
func GetMerchantTransactions(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		// Parse pagination params from query string
		limit, cursor, err := utils.ParsePaginationParams(
			c.Query("limit"),
			c.Query("cursor"),
		)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid pagination parameters: " + err.Error(),
			})
		}

		// Get user's organizations to determine organization context
		memberships, err := dbengine.GetUserOrganizations(c.Context(), pool, user.ID)
		if err != nil {
			slog.Error("get user organizations", "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to get user organizations"})
		}
		if len(memberships) == 0 {
			slog.Error("user has no organizations", "user_id", user.ID)
			return c.Status(400).JSON(fiber.Map{"error": "user must belong to an organization"})
		}

		// Derive selectedOrgID from request or user's active selection
		var selectedOrgID string

		// Check for organization_id in request query params
		if orgID := c.Query("org_id"); orgID != "" {
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
		} else if orgID := c.Query("organization_id"); orgID != "" {
			// Also check for organization_id parameter
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
		} else if len(memberships) == 1 {
			// If only one membership exists, use that
			selectedOrgID = memberships[0].OrganizationID
		} else {
			personalOrgID, err := dbengine.GetUserPersonalOrgID(c.Context(), pool, user.ID)
			if err != nil {
				return c.Status(400).JSON(fiber.Map{"error": "multiple organizations found, please specify org_id or organization_id parameter"})
			}
			selectedOrgID = personalOrgID
		}

		// Fetch paginated transactions with total count
		transactions, nextCursor, total, err := dbengine.GetMerchantTransactionsPaginated(
			c.Context(), pool, selectedOrgID, limit, cursor,
		)
		if err != nil {
			slog.Error("fetch transactions: query failed", "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to retrieve transactions",
			})
		}

		// Build pagination metadata
		paginationMeta := dbengine.PaginationMeta{
			HasMore: nextCursor != nil,
			Count:   len(transactions),
			Limit:   limit,
			Total:   total,
		}
		if nextCursor != nil {
			encoded := utils.EncodeCursor(*nextCursor)
			paginationMeta.NextCursor = &encoded
		}

		// Return paginated response
		response := dbengine.TransactionsResponse{
			Data:       transactions,
			Pagination: paginationMeta,
		}

		return c.JSON(response)
	}
}
