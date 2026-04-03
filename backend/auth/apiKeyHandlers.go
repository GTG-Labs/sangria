package auth

import (
	"log"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ListAPIKeys handles GET /api-keys
func ListAPIKeys(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user := c.Locals("workos_user").(WorkOSUser)

		apiKeys, err := GetAPIKeysByUserID(c.Context(), pool, user.ID)
		if err != nil {
			log.Printf("Failed to get API keys for user %s: %v", user.ID, err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve API keys"})
		}

		// Remove sensitive data before returning
		for i := range apiKeys {
			apiKeys[i].APIKey = "" // Never expose the hash
		}

		return c.JSON(apiKeys)
	}
}

// DeleteAPIKey handles DELETE /api-keys/:id
func DeleteAPIKey(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user := c.Locals("workos_user").(WorkOSUser)
		keyID := c.Params("id")

		if keyID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "API key ID is required"})
		}

		err := RevokeAPIKey(c.Context(), pool, keyID, user.ID)
		if err != nil {
			log.Printf("Failed to revoke API key %s for user %s: %v", keyID, user.ID, err)
			return c.Status(404).JSON(fiber.Map{"error": "API key not found or not owned by user"})
		}

		return c.Status(204).Send(nil)
	}
}