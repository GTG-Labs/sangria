package adminHandlers

import (
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangria/backend/dbEngine"
	"sangria/backend/utils"
)

// GetAllTransactions handles GET /admin/transactions with cursor-based pagination.
// Supports query params: limit, cursor, organization_id, search, start_date, end_date
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

		// Parse optional filters
		var filters dbengine.AdminTransactionFilters

		if oid := c.Query("organization_id"); oid != "" {
			filters.OrganizationID = &oid
		}
		if search := c.Query("search"); search != "" {
			filters.Search = &search
		}
		if sd := c.Query("start_date"); sd != "" {
			t, err := time.Parse(time.RFC3339, sd)
			if err != nil {
				return c.Status(400).JSON(fiber.Map{"error": "Invalid start_date format, use RFC3339"})
			}
			filters.StartDate = &t
		}
		if ed := c.Query("end_date"); ed != "" {
			t, err := time.Parse(time.RFC3339, ed)
			if err != nil {
				return c.Status(400).JSON(fiber.Map{"error": "Invalid end_date format, use RFC3339"})
			}
			filters.EndDate = &t
		}

		transactions, nextCursor, total, err := dbengine.GetAdminTransactionsPaginated(
			c.Context(), pool, limit, cursor, filters,
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

		// Fetch totals only on first page to avoid extra query on pagination
		var totals *dbengine.AdminTotals
		if cursor == nil {
			t, err := dbengine.GetAdminTransactionTotals(c.Context(), pool, filters)
			if err != nil {
				slog.Error("admin: fetch transaction totals failed", "error", err)
			} else {
				totals = &t
			}
		}

		return c.JSON(dbengine.AdminTransactionsResponse{
			Data:       transactions,
			Pagination: paginationMeta,
			Totals:     totals,
		})
	}
}

// GetTransactionLedger handles GET /admin/transactions/:id/ledger.
// Returns all ledger entries for a transaction with account details.
func GetTransactionLedger(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		txID := c.Params("id")
		if txID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Transaction ID required"})
		}

		entries, err := dbengine.GetLedgerEntriesByTransactionID(c.Context(), pool, txID)
		if err != nil {
			slog.Error("admin: fetch ledger entries failed", "transaction_id", txID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve ledger entries"})
		}

		return c.JSON(fiber.Map{"entries": entries})
	}
}
