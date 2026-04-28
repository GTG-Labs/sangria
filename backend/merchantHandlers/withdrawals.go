package merchantHandlers

import (
	"errors"
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/auth"
	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
	"sangria/backend/utils"
)

// RequestWithdrawal handles POST /withdrawals.
// Dashboard endpoint — only an admin of the organization may initiate a
// withdrawal. Authorization is enforced atomically in SQL (see
// dbengine.CreateWithdrawal) to prevent TOCTOU.
func RequestWithdrawal(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		var req struct {
			OrganizationID string `json:"organization_id"`
			Amount         int64  `json:"amount"`
			IdempotencyKey string `json:"idempotency_key"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		if req.OrganizationID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "organization_id is required"})
		}
		if req.IdempotencyKey == "" {
			return c.Status(400).JSON(fiber.Map{"error": "idempotency_key is required"})
		}
		if req.Amount <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "amount must be a positive integer (microunits)"})
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
			req.OrganizationID, req.Amount, fee, req.IdempotencyKey,
			autoApprove, user.ID,
		)
		if err != nil {
			if errors.Is(err, dbengine.ErrInsufficientBalance) {
				return c.Status(400).JSON(fiber.Map{"error": "insufficient balance"})
			}
			if errors.Is(err, dbengine.ErrWithdrawalNotFound) {
				return c.Status(404).JSON(fiber.Map{"error": "organization not found or access denied"})
			}
			slog.Error("create withdrawal", "organization_id", req.OrganizationID, "error", err)
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

// ListWithdrawals handles GET /withdrawals with cursor-based pagination.
// Dashboard endpoint — returns withdrawals for the user's organization.
// Query params: ?limit=20&cursor=base64_encoded_timestamp&org_id=optional
func ListWithdrawals(pool *pgxpool.Pool) fiber.Handler {
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

		// Fetch paginated withdrawals for the organization
		withdrawals, nextCursor, total, err := dbengine.GetWithdrawalsByOrganizationPaginated(
			c.Context(), pool, selectedOrgID, limit, cursor,
		)
		if err != nil {
			slog.Error("fetch withdrawals: query failed", "user_id", user.ID, "org_id", selectedOrgID, "error", err)
			return c.Status(500).JSON(fiber.Map{
				"error": "failed to retrieve withdrawals",
			})
		}

		// Build pagination metadata
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

		// Return paginated response
		response := dbengine.WithdrawalsResponse{
			Data:       withdrawals,
			Pagination: paginationMeta,
		}

		return c.JSON(response)
	}
}

// CancelWithdrawal handles POST /withdrawals/:id/cancel.
// Dashboard endpoint — only an admin of the organization may cancel a pending
// withdrawal. Authorization is enforced atomically in SQL (see
// dbengine.CancelWithdrawal) to prevent TOCTOU.
func CancelWithdrawal(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}
		withdrawalID := c.Params("id")

		var req struct {
			OrganizationID string `json:"organization_id"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}
		if req.OrganizationID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "organization_id is required"})
		}

		if err := dbengine.CancelWithdrawal(c.Context(), pool, withdrawalID, req.OrganizationID, user.ID); err != nil {
			if errors.Is(err, dbengine.ErrWithdrawalNotFound) {
				return c.Status(404).JSON(fiber.Map{"error": "withdrawal not found, not pending approval, or access denied"})
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
