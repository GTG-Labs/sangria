package auth

import (
	"errors"
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
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

		// TEMPORARY: Explicitly fail until organization context is implemented
		slog.Warn("ListAPIKeys: organization context not implemented", "user_id", user.ID)
		return c.Status(501).JSON(fiber.Map{"error": "organization context not implemented yet"})

		// Remove sensitive data before returning (when implemented)
		// for i := range apiKeys {
		// 	apiKeys[i].APIKey = "" // Never expose the hash
		// }

		// return c.JSON(apiKeys)
	}
}

// DeleteAPIKey handles DELETE /api-keys/:id (admin-only)
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

		// Feature flag to control organization context behavior
		useOrganizationContext := false // TODO: Replace with actual feature flag

		if useOrganizationContext {
			// TODO: Get current organization context from user session/header
			// organizationID := getSelectedOrganizationID(c, user.ID)
			// err := RevokeAPIKey(c.Context(), pool, keyID, organizationID)

			// TEMPORARY: Organization context not implemented yet
			slog.Warn("DeleteAPIKey: organization context not implemented yet", "user_id", user.ID, "key_id", keyID)
			return c.Status(501).JSON(fiber.Map{"error": "organization context not implemented yet"})
		} else {
			// Current admin-only deletion flow
			err := RevokeAPIKey(c.Context(), pool, keyID, user.ID)
			if err != nil {
				if errors.Is(err, ErrAPIKeyNotFound) {
					return c.Status(404).JSON(fiber.Map{"error": "API key not found or not owned by user"})
				}
				slog.Error("revoke API key: failed", "key_id", keyID, "user_id", user.ID, "error", err)
				return c.Status(500).JSON(fiber.Map{"error": "failed to revoke API key"})
			}

			return c.Status(204).Send(nil)
		}
	}
}