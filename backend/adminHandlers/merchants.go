package adminHandlers

import (
	"errors"
	"log"

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
		user := c.Locals("workos_user").(auth.WorkOSUser)

		var req struct {
			Name   string `json:"name"`
			IsLive bool   `json:"is_live"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		if req.Name == "" {
			return c.Status(400).JSON(fiber.Map{"error": "name is required"})
		}

		// Ensure the user exists in the database first
		if _, err := dbengine.UpsertUser(c.Context(), pool, "Admin Created", user.ID); err != nil {
			log.Printf("upsert user: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create user"})
		}

		// Ensure the user has a USDC LIABILITY account before creating the API key,
		// so we don't end up with an active key but no liability account.
		if _, err := dbengine.EnsureUSDLiabilityAccount(c.Context(), pool, user.ID); err != nil {
			log.Printf("ensure usdc liability account: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create liability account"})
		}

		// Use the structured API key generation (sg_live_/sg_test_ prefix with keyID).
		merchant, fullKey, err := auth.CreateAPIKey(c.Context(), pool, user.ID, req.Name, req.IsLive)
		if err != nil {
			if errors.Is(err, auth.ErrMaxAPIKeysReached) {
				return c.Status(400).JSON(fiber.Map{"error": "maximum number of API keys reached (10)"})
			}
			log.Printf("create merchant api key: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create merchant"})
		}

		// Return merchant record + raw key (only shown once).
		return c.Status(201).JSON(fiber.Map{
			"id":         merchant.ID,
			"user_id":    merchant.UserID,
			"name":       merchant.Name,
			"key_id":     merchant.KeyID,
			"api_key":    fullKey,
			"is_active":  merchant.IsActive,
			"created_at": merchant.CreatedAt,
		})
	}
}
