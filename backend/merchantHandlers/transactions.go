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

		// Resolve organization context
		orgResult := auth.ResolveOrganizationContext(c.Context(), c, pool, user)
		if orgResult.Error != "" {
			return c.Status(orgResult.HTTPStatus).JSON(fiber.Map{"error": orgResult.Error})
		}
		selectedOrgID := orgResult.OrganizationID

		balance, err := dbengine.GetAccountBalance(c.Context(), pool, selectedOrgID)
		if err != nil {
			slog.Error("fetch balance: query failed", "user_id", user.ID, "org_id", selectedOrgID, "error", err)
			return c.Status(500).JSON(fiber.Map{
				"error": "failed to retrieve balance",
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

		// Resolve organization context
		orgResult := auth.ResolveOrganizationContext(c.Context(), c, pool, user)
		if orgResult.Error != "" {
			return c.Status(orgResult.HTTPStatus).JSON(fiber.Map{"error": orgResult.Error})
		}
		selectedOrgID := orgResult.OrganizationID

		// Fetch paginated transactions with total count
		transactions, nextCursor, total, err := dbengine.GetMerchantTransactionsPaginated(
			c.Context(), pool, selectedOrgID, limit, cursor,
		)
		if err != nil {
			slog.Error("fetch transactions: query failed", "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{
				"error": "failed to retrieve transactions",
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
