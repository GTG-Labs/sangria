package merchantHandlers

import (
	"log"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangria/backend/dbEngine"
)

// GetMerchantProfile handles GET /merchants/profile.
// Returns the authenticated merchant's profile using their API key.
func GetMerchantProfile(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		merchantKey := c.Locals("merchant_api_key").(*dbengine.Merchant)

		// Get user information
		user, err := dbengine.GetUserByWorkosID(c.Context(), pool, merchantKey.UserID)
		if err != nil {
			log.Printf("Failed to get user for API key %s: %v", merchantKey.ID, err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve merchant profile"})
		}

		response := fiber.Map{
			"user": user,
			"api_key": fiber.Map{
				"id":           merchantKey.ID,
				"name":         merchantKey.Name,
				"is_active":    merchantKey.IsActive,
				"last_used_at": merchantKey.LastUsedAt,
				"created_at":   merchantKey.CreatedAt,
			},
		}

		return c.JSON(response)
	}
}
