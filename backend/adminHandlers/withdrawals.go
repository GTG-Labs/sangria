package adminHandlers

import (
	"errors"
	"fmt"
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/auth"
	dbengine "sangria/backend/dbEngine"
	"sangria/backend/utils"
)

// ApproveWithdrawal handles POST /admin/withdrawals/:id/approve.
// Admin approves a pending withdrawal.
func ApproveWithdrawal(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		admin, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}
		withdrawalID := c.Params("id")

		var req struct {
			Note string `json:"note"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			if len(c.Body()) == 0 {
				// Note is optional — allow empty body.
				req.Note = ""
			} else {
				return c.Status(400).JSON(fiber.Map{"error": fmt.Sprintf("invalid request body: %v", err)})
			}
		}

		if err := dbengine.ApproveWithdrawal(c.Context(), pool, withdrawalID, admin.ID, req.Note); err != nil {
			if errors.Is(err, dbengine.ErrWithdrawalNotFound) {
				return c.Status(400).JSON(fiber.Map{"error": "withdrawal not found or not pending approval"})
			}
			slog.Error("approve withdrawal", "withdrawal_id", withdrawalID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to approve withdrawal"})
		}

		withdrawal, err := dbengine.GetWithdrawalByID(c.Context(), pool, withdrawalID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch withdrawal"})
		}

		return c.JSON(withdrawal)
	}
}

// RejectWithdrawal handles POST /admin/withdrawals/:id/reject.
// Admin rejects a pending withdrawal and reverses the balance debit.
func RejectWithdrawal(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		admin, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}
		withdrawalID := c.Params("id")

		var req struct {
			Note string `json:"note"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			if len(c.Body()) == 0 {
				req.Note = ""
			} else {
				return c.Status(400).JSON(fiber.Map{"error": fmt.Sprintf("invalid request body: %v", err)})
			}
		}

		if err := dbengine.RejectWithdrawal(c.Context(), pool, withdrawalID, admin.ID, req.Note); err != nil {
			if errors.Is(err, dbengine.ErrWithdrawalNotFound) {
				return c.Status(400).JSON(fiber.Map{"error": "withdrawal not found or not pending approval"})
			}
			slog.Error("reject withdrawal", "withdrawal_id", withdrawalID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to reject withdrawal"})
		}

		withdrawal, err := dbengine.GetWithdrawalByID(c.Context(), pool, withdrawalID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch withdrawal"})
		}

		return c.JSON(withdrawal)
	}
}

// CompleteWithdrawal handles POST /admin/withdrawals/:id/complete.
// Admin marks a withdrawal as completed after manually sending the bank transfer.
func CompleteWithdrawal(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		admin, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}
		withdrawalID := c.Params("id")

		if err := dbengine.CompleteWithdrawal(c.Context(), pool, withdrawalID, admin.ID); err != nil {
			if errors.Is(err, dbengine.ErrWithdrawalNotFound) {
				return c.Status(400).JSON(fiber.Map{"error": "withdrawal not found or not in approved/processing state"})
			}
			slog.Error("complete withdrawal", "withdrawal_id", withdrawalID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to complete withdrawal"})
		}

		withdrawal, err := dbengine.GetWithdrawalByID(c.Context(), pool, withdrawalID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch withdrawal"})
		}

		return c.JSON(withdrawal)
	}
}

// FailWithdrawal handles POST /admin/withdrawals/:id/fail.
// Admin marks a withdrawal as failed (e.g., bank transfer bounced) and reverses the balance debit.
func FailWithdrawal(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		admin, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}
		withdrawalID := c.Params("id")

		var req struct {
			FailureCode    string `json:"failure_code"`
			FailureMessage string `json:"failure_message"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": fmt.Sprintf("invalid request body: %v", err)})
		}

		if req.FailureCode == "" {
			return c.Status(400).JSON(fiber.Map{"error": "failure_code is required"})
		}
		if len(req.FailureCode) > 100 {
			return c.Status(400).JSON(fiber.Map{"error": "failure_code must be at most 100 characters"})
		}
		if len(req.FailureMessage) > 1000 {
			return c.Status(400).JSON(fiber.Map{"error": "failure_message must be at most 1000 characters"})
		}

		if err := dbengine.FailWithdrawal(c.Context(), pool, withdrawalID, admin.ID, req.FailureCode, req.FailureMessage); err != nil {
			if errors.Is(err, dbengine.ErrWithdrawalNotFound) {
				return c.Status(400).JSON(fiber.Map{"error": "withdrawal not found or not in approved/processing state"})
			}
			slog.Error("fail withdrawal", "withdrawal_id", withdrawalID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to mark withdrawal as failed"})
		}

		withdrawal, err := dbengine.GetWithdrawalByID(c.Context(), pool, withdrawalID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch withdrawal"})
		}

		return c.JSON(withdrawal)
	}
}

// ListAllWithdrawals handles GET /admin/withdrawals with cursor-based pagination.
// Returns all withdrawals, optionally filtered by status.
// Query params: ?limit=20&cursor=base64_encoded_timestamp&status=optional
func ListAllWithdrawals(pool *pgxpool.Pool) fiber.Handler {
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

		status := c.Query("status")

		withdrawals, nextCursor, total, err := dbengine.GetAllWithdrawalsPaginated(
			c.Context(), pool, status, limit, cursor,
		)
		if err != nil {
			if errors.Is(err, dbengine.ErrInvalidWithdrawalStatus) {
				return c.Status(400).JSON(fiber.Map{"error": err.Error()})
			}
			slog.Error("list all withdrawals", "status", status, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to list withdrawals"})
		}

		paginationMeta := dbengine.PaginationMeta{
			HasMore: nextCursor != nil,
			Count:   len(withdrawals),
			Limit:   limit,
			Total:   total,
		}
		if nextCursor != nil {
			encoded := utils.EncodeCursor(*nextCursor)
			paginationMeta.NextCursor = &encoded
		}

		return c.JSON(dbengine.WithdrawalsResponse{
			Data:       withdrawals,
			Pagination: paginationMeta,
		})
	}
}
