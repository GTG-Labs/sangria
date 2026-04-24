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

		// Get user organizations to validate merchant access
		memberships, err := dbengine.GetUserOrganizations(c.Context(), pool, user.ID)
		if err != nil {
			slog.Error("get user organizations", "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to get user organizations"})
		}
		if len(memberships) == 0 {
			slog.Error("user has no organizations", "user_id", user.ID)
			return c.Status(400).JSON(fiber.Map{"error": "user must belong to an organization"})
		}

		// Verify this merchant belongs to the authenticated user's organization.
		merchant, err := dbengine.GetMerchantByID(c.Context(), pool, req.MerchantID)
		if err != nil {
			if errors.Is(err, dbengine.ErrMerchantNotFound) {
				return c.Status(404).JSON(fiber.Map{"error": "merchant not found"})
			}
			slog.Error("get merchant", "merchant_id", req.MerchantID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to look up merchant"})
		}

		// Check if user is a member of the organization that owns this merchant
		userHasAccess := false
		for _, membership := range memberships {
			if membership.OrganizationID == merchant.OrganizationID {
				userHasAccess = true
				break
			}
		}
		if !userHasAccess {
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

		// Get user organizations to validate merchant access
		memberships, err := dbengine.GetUserOrganizations(c.Context(), pool, user.ID)
		if err != nil {
			slog.Error("get user organizations", "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to get user organizations"})
		}
		if len(memberships) == 0 {
			slog.Error("user has no organizations", "user_id", user.ID)
			return c.Status(400).JSON(fiber.Map{"error": "user must belong to an organization"})
		}

		// Verify this merchant belongs to the authenticated user's organization.
		merchant, err := dbengine.GetMerchantByID(c.Context(), pool, req.MerchantID)
		if err != nil {
			if errors.Is(err, dbengine.ErrMerchantNotFound) {
				return c.Status(404).JSON(fiber.Map{"error": "merchant not found"})
			}
			slog.Error("get merchant", "merchant_id", req.MerchantID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to look up merchant"})
		}

		// Check if user is a member of the organization that owns this merchant
		userHasAccess := false
		for _, membership := range memberships {
			if membership.OrganizationID == merchant.OrganizationID {
				userHasAccess = true
				break
			}
		}
		if !userHasAccess {
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
