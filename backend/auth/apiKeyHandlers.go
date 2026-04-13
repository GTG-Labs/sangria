package auth

import (
	"errors"
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangria/backend/dbEngine"
)

// ListAPIKeys handles GET /api-keys
func ListAPIKeys(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		// TODO: Get current organization context from user session/header
		// For now, this will need to be updated when organization selection is implemented
		// organizationID := getSelectedOrganizationID(c, user.ID)
		// apiKeys, err := GetAPIKeysByOrganizationID(c.Context(), pool, organizationID)

		// TEMPORARY: Return empty list until organization context is implemented
		apiKeys := []dbengine.Merchant{}
		slog.Warn("ListAPIKeys: organization context not implemented", "user_id", user.ID)

		// Remove sensitive data before returning (when implemented)
		// for i := range apiKeys {
		// 	apiKeys[i].APIKey = "" // Never expose the hash
		// }

		return c.JSON(apiKeys)
	}
}

// DeleteAPIKey handles DELETE /api-keys/:id
func DeleteAPIKey(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}
		keyID := c.Params("id")

		if keyID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "API key ID is required"})
		}

		// TODO: Get current organization context from user session/header
		// For now, this will need to be updated when organization selection is implemented
		// organizationID := getSelectedOrganizationID(c, user.ID)
		// err := RevokeAPIKey(c.Context(), pool, keyID, organizationID)

		// TEMPORARY: Return not implemented until organization context is implemented
		slog.Warn("DeleteAPIKey: organization context not implemented", "user_id", user.ID, "key_id", keyID)
		return c.Status(501).JSON(fiber.Map{"error": "organization context not implemented yet"})
	}
}