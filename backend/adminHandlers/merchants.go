package adminHandlers

import (
	"errors"
	"log/slog"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/auth"
	dbengine "sangria/backend/dbEngine"
)

// CreateMerchantAPIKey handles POST /merchants.
// Creates a merchant API key and USDC LIABILITY account for a user (admin-only, WorkOS JWT auth).
func CreateMerchantAPIKey(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		// Get authenticated user from middleware context
		user, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		var req struct {
			Name string `json:"name"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" {
			return c.Status(400).JSON(fiber.Map{"error": "name is required"})
		}
		if len(req.Name) > 255 {
			return c.Status(400).JSON(fiber.Map{"error": "name must be 255 characters or less"})
		}

		// Ensure the user exists in the database first
		owner := user.Email
		if user.FirstName != "" && user.LastName != "" {
			owner = user.FirstName + " " + user.LastName
		}
		if _, err := dbengine.UpsertUser(c.Context(), pool, owner, user.ID); err != nil {
			slog.Error("upsert user", "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create user"})
		}

		// Resolve organization context
		orgResult := auth.ResolveOrganizationContext(c.Context(), c, pool, user)
		if orgResult.Error != "" {
			// Convert 400 status to 403 for consistency with existing error handling in this handler
			status := orgResult.HTTPStatus
			if status == 400 && orgResult.Error == "user is not a member of the specified organization" {
				status = 403
			}
			return c.Status(status).JSON(fiber.Map{"error": orgResult.Error})
		}
		selectedOrgID := orgResult.OrganizationID
		memberships := orgResult.Memberships

		// Ensure the organization has a USD LIABILITY account before creating the API key,
		// so we don't end up with an active key but no liability account.
		if _, err := dbengine.EnsureUSDLiabilityAccount(c.Context(), pool, selectedOrgID); err != nil {
			slog.Error("ensure USD liability account", "org_id", selectedOrgID, "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create liability account"})
		}

		// Determine if user is admin for this organization
		isAdmin := false
		for _, membership := range memberships {
			if membership.OrganizationID == selectedOrgID && membership.IsAdmin {
				isAdmin = true
				break
			}
		}

		// Set status based on admin status
		var keyStatus dbengine.APIKeyStatus
		if isAdmin {
			keyStatus = dbengine.APIKeyStatusActive // Admin keys are immediately active
		} else {
			keyStatus = dbengine.APIKeyStatusPending // Non-admin keys need approval
		}

		merchant, fullKey, err := auth.CreateAPIKey(c.Context(), pool, selectedOrgID, req.Name, keyStatus)
		if err != nil {
			if errors.Is(err, dbengine.ErrMaxAPIKeysReached) {
				return c.Status(400).JSON(fiber.Map{"error": "maximum number of API keys reached (10). This includes active and pending keys."})
			}
			slog.Error("create merchant API key", "org_id", selectedOrgID, "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create merchant"})
		}

		// Different response based on status
		if keyStatus == dbengine.APIKeyStatusPending {
			return c.Status(202).JSON(fiber.Map{
				"message":         "API key created but pending admin approval",
				"id":              merchant.ID,
				"organization_id": merchant.OrganizationID,
				"name":            merchant.Name,
				"key_id":          merchant.KeyID,
				"api_key":         fullKey, // User sees the key immediately but it's not active yet
				"status":          merchant.Status,
				"created_at":      merchant.CreatedAt,
			})
		}

		return c.Status(201).JSON(fiber.Map{
			"id":              merchant.ID,
			"organization_id": merchant.OrganizationID,
			"name":            merchant.Name,
			"key_id":          merchant.KeyID,
			"api_key":         fullKey,
			"status":          merchant.Status,
			"created_at":      merchant.CreatedAt,
		})
	}
}
