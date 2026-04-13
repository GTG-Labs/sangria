package adminHandlers

import (
	"errors"
	"fmt"
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/auth"
	dbengine "sangria/backend/dbEngine"
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
		withdrawalID := c.Params("id")

		if err := dbengine.CompleteWithdrawal(c.Context(), pool, withdrawalID); err != nil {
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

		if err := dbengine.FailWithdrawal(c.Context(), pool, withdrawalID, req.FailureCode, req.FailureMessage); err != nil {
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

// ListAllWithdrawals handles GET /admin/withdrawals.
// Returns all withdrawals, optionally filtered by status.
func ListAllWithdrawals(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		status := c.Query("status")

		if status != "" {
			withdrawals, err := dbengine.ListWithdrawalsByStatus(c.Context(), pool, dbengine.WithdrawalStatus(status))
			if err != nil {
				slog.Error("list withdrawals by status", "status", status, "error", err)
				return c.Status(500).JSON(fiber.Map{"error": "failed to list withdrawals"})
			}
			return c.JSON(withdrawals)
		}

		// No filter — return all withdrawals.
		withdrawals, err := dbengine.ListAllWithdrawals(c.Context(), pool)
		if err != nil {
			slog.Error("list all withdrawals", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to list withdrawals"})
		}
		return c.JSON(withdrawals)
	}
}
