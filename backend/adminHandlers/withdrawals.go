package adminHandlers

import (
	"log"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangrianet/backend/auth"
	dbengine "sangrianet/backend/dbEngine"
)

// ApproveWithdrawal handles POST /admin/withdrawals/:id/approve.
// Admin approves a pending withdrawal.
func ApproveWithdrawal(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		admin := c.Locals("workos_user").(auth.WorkOSUser)
		withdrawalID := c.Params("id")

		var req struct {
			Note string `json:"note"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			// Note is optional — allow empty body.
			req.Note = ""
		}

		if err := dbengine.ApproveWithdrawal(c.Context(), pool, withdrawalID, admin.ID, req.Note); err != nil {
			log.Printf("approve withdrawal %s: %v", withdrawalID, err)
			return c.Status(400).JSON(fiber.Map{"error": "withdrawal not found or not pending approval"})
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
		admin := c.Locals("workos_user").(auth.WorkOSUser)
		withdrawalID := c.Params("id")

		var req struct {
			Note string `json:"note"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			req.Note = ""
		}

		if err := dbengine.RejectWithdrawal(c.Context(), pool, withdrawalID, admin.ID, req.Note); err != nil {
			log.Printf("reject withdrawal %s: %v", withdrawalID, err)
			return c.Status(400).JSON(fiber.Map{"error": "withdrawal not found or not pending approval"})
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
			log.Printf("complete withdrawal %s: %v", withdrawalID, err)
			return c.Status(400).JSON(fiber.Map{"error": "withdrawal not found or not in approved/processing state"})
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
				log.Printf("list withdrawals by status: %v", err)
				return c.Status(500).JSON(fiber.Map{"error": "failed to list withdrawals"})
			}
			return c.JSON(withdrawals)
		}

		// No filter — return all pending_approval first (most actionable).
		withdrawals, err := dbengine.ListWithdrawalsByStatus(c.Context(), pool, dbengine.WithdrawalStatusPendingApproval)
		if err != nil {
			log.Printf("list pending withdrawals: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to list withdrawals"})
		}
		return c.JSON(withdrawals)
	}
}
