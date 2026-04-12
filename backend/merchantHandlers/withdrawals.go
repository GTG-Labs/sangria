package merchantHandlers

import (
	"errors"
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/auth"
	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
)

// RequestWithdrawal handles POST /withdrawals.
// Dashboard endpoint — user logs in via WorkOS, picks which merchant account to withdraw from.
func RequestWithdrawal(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		var req struct {
			MerchantID     string `json:"merchant_id"`
			Amount         int64  `json:"amount"`
			IdempotencyKey string `json:"idempotency_key"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		if req.MerchantID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "merchant_id is required"})
		}
		if req.IdempotencyKey == "" {
			return c.Status(400).JSON(fiber.Map{"error": "idempotency_key is required"})
		}
		if req.Amount <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "amount must be a positive integer (microunits)"})
		}

		// Verify this merchant belongs to the authenticated user.
		merchant, err := dbengine.GetMerchantByID(c.Context(), pool, req.MerchantID)
		if err != nil {
			if errors.Is(err, dbengine.ErrMerchantNotFound) {
				return c.Status(404).JSON(fiber.Map{"error": "merchant not found"})
			}
			slog.Error("get merchant", "merchant_id", req.MerchantID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to look up merchant"})
		}
		if merchant.UserID != user.ID {
			return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
		}

		// Validate minimum withdrawal.
		if req.Amount < config.WithdrawalConfig.MinAmount {
			return c.Status(400).JSON(fiber.Map{
				"error":      "below minimum withdrawal amount",
				"min_amount": config.WithdrawalConfig.MinAmount,
			})
		}

		// Calculate fee and auto-approve decision.
		fee := config.WithdrawalConfig.CalculateWithdrawalFee(req.Amount)
		autoApprove := config.WithdrawalConfig.ShouldAutoApprove(req.Amount)

		withdrawal, err := dbengine.CreateWithdrawal(
			c.Context(), pool,
			merchant.ID, req.Amount, fee, req.IdempotencyKey,
			autoApprove,
		)
		if err != nil {
			if errors.Is(err, dbengine.ErrInsufficientBalance) {
				return c.Status(400).JSON(fiber.Map{"error": "insufficient balance"})
			}
			slog.Error("create withdrawal", "merchant_id", merchant.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create withdrawal"})
		}

		return c.Status(201).JSON(fiber.Map{
			"id":         withdrawal.ID,
			"amount":     withdrawal.Amount,
			"fee":        withdrawal.Fee,
			"net_amount": withdrawal.NetAmount,
			"status":     withdrawal.Status,
			"created_at": withdrawal.CreatedAt,
		})
	}
}

// ListWithdrawals handles GET /withdrawals.
// Dashboard endpoint — returns withdrawals for a specific merchant owned by the authenticated user.
func ListWithdrawals(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		merchantID := c.Query("merchant_id")
		if merchantID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "merchant_id query param is required"})
		}

		// Verify this merchant belongs to the authenticated user.
		merchant, err := dbengine.GetMerchantByID(c.Context(), pool, merchantID)
		if err != nil {
			if errors.Is(err, dbengine.ErrMerchantNotFound) {
				return c.Status(404).JSON(fiber.Map{"error": "merchant not found"})
			}
			slog.Error("get merchant", "merchant_id", merchantID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to look up merchant"})
		}
		if merchant.UserID != user.ID {
			return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
		}

		withdrawals, err := dbengine.ListWithdrawalsByMerchant(c.Context(), pool, merchant.ID)
		if err != nil {
			slog.Error("list withdrawals", "merchant_id", merchant.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to list withdrawals"})
		}

		return c.JSON(withdrawals)
	}
}

// CancelWithdrawal handles POST /withdrawals/:id/cancel.
// Dashboard endpoint — merchant cancels their own pending withdrawal.
func CancelWithdrawal(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}
		withdrawalID := c.Params("id")

		var req struct {
			MerchantID string `json:"merchant_id"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}
		if req.MerchantID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "merchant_id is required"})
		}

		// Verify this merchant belongs to the authenticated user.
		merchant, err := dbengine.GetMerchantByID(c.Context(), pool, req.MerchantID)
		if err != nil {
			if errors.Is(err, dbengine.ErrMerchantNotFound) {
				return c.Status(404).JSON(fiber.Map{"error": "merchant not found"})
			}
			slog.Error("get merchant", "merchant_id", req.MerchantID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to look up merchant"})
		}
		if merchant.UserID != user.ID {
			return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
		}

		if err := dbengine.CancelWithdrawal(c.Context(), pool, withdrawalID, merchant.ID); err != nil {
			if errors.Is(err, dbengine.ErrWithdrawalNotFound) {
				return c.Status(400).JSON(fiber.Map{"error": "withdrawal not found or not pending approval"})
			}
			slog.Error("cancel withdrawal", "withdrawal_id", withdrawalID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to cancel withdrawal"})
		}

		withdrawal, err := dbengine.GetWithdrawalByID(c.Context(), pool, withdrawalID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch withdrawal"})
		}

		return c.JSON(withdrawal)
	}
}
