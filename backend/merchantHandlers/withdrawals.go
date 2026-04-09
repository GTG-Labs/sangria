package merchantHandlers

import (
	"errors"
	"log"
	"math"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangrianet/backend/auth"
	"sangrianet/backend/config"
	dbengine "sangrianet/backend/dbEngine"
)

// RequestWithdrawal handles POST /withdrawals.
// Dashboard endpoint — user logs in via WorkOS, picks which merchant account to withdraw from.
func RequestWithdrawal(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user := c.Locals("workos_user").(auth.WorkOSUser)

		var req struct {
			MerchantID     string  `json:"merchant_id"`
			Amount         float64 `json:"amount"`
			IdempotencyKey string  `json:"idempotency_key"`
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
		if math.IsInf(req.Amount, 0) || math.IsNaN(req.Amount) || req.Amount <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "amount must be a positive number"})
		}

		// Verify this merchant belongs to the authenticated user.
		merchant, err := dbengine.GetMerchantByID(c.Context(), pool, req.MerchantID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "merchant not found"})
		}
		if merchant.UserID != user.ID {
			return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
		}

		// Convert dollars to microunits.
		rounded := math.Round(req.Amount * 1e6)
		if rounded <= 0 || rounded > float64(math.MaxInt64) {
			return c.Status(400).JSON(fiber.Map{"error": "amount out of range"})
		}
		amountMicro := int64(rounded)

		// Validate minimum withdrawal.
		if amountMicro < config.WithdrawalConfig.MinAmount {
			return c.Status(400).JSON(fiber.Map{
				"error":      "below minimum withdrawal amount",
				"min_amount": config.WithdrawalConfig.MinAmount,
			})
		}

		// Calculate fee and auto-approve decision.
		fee := config.WithdrawalConfig.CalculateWithdrawalFee(amountMicro)
		autoApprove := config.WithdrawalConfig.ShouldAutoApprove(amountMicro)

		withdrawal, err := dbengine.CreateWithdrawal(
			c.Context(), pool,
			merchant.ID, amountMicro, fee, req.IdempotencyKey,
			autoApprove,
		)
		if err != nil {
			if errors.Is(err, dbengine.ErrInsufficientBalance) {
				return c.Status(400).JSON(fiber.Map{"error": "insufficient balance"})
			}
			log.Printf("create withdrawal: %v", err)
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
		user := c.Locals("workos_user").(auth.WorkOSUser)

		merchantID := c.Query("merchant_id")
		if merchantID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "merchant_id query param is required"})
		}

		// Verify this merchant belongs to the authenticated user.
		merchant, err := dbengine.GetMerchantByID(c.Context(), pool, merchantID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "merchant not found"})
		}
		if merchant.UserID != user.ID {
			return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
		}

		withdrawals, err := dbengine.ListWithdrawalsByMerchant(c.Context(), pool, merchant.ID)
		if err != nil {
			log.Printf("list withdrawals: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to list withdrawals"})
		}

		return c.JSON(withdrawals)
	}
}
