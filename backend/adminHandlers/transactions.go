package adminHandlers

import (
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangria/backend/dbEngine"
	"sangria/backend/utils"
)

// GetAllTransactions handles GET /admin/transactions with cursor-based pagination.
// Returns all transactions across all merchants.
func GetAllTransactions(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		limit, cursor, err := utils.ParsePaginationParams(
			c.Query("limit"),
			c.Query("cursor"),
		)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid pagination parameters: " + err.Error(),
			})
		}

		transactions, nextCursor, total, err := dbengine.GetAllTransactionsPaginated(
			c.Context(), pool, limit, cursor,
		)
		if err != nil {
			slog.Error("admin: fetch all transactions failed", "error", err)
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to retrieve transactions",
			})
		}

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

		return c.JSON(dbengine.TransactionsResponse{
			Data:       transactions,
			Pagination: paginationMeta,
		})
	}
}
