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

		// Resolve organization context
		orgResult := ResolveOrganizationContext(c.Context(), c, pool, user)
		if orgResult.Error != "" {
			return c.Status(orgResult.HTTPStatus).JSON(fiber.Map{"error": orgResult.Error})
		}
		selectedOrgID := orgResult.OrganizationID

		apiKeys, err := GetAPIKeysByOrganizationID(c.Context(), pool, selectedOrgID)
		if err != nil {
			slog.Error("list API keys: query failed", "user_id", user.ID, "org_id", selectedOrgID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve API keys"})
		}

		return c.JSON(apiKeys)
	}
}

// DeleteAPIKey handles DELETE /api-keys/:id (org admin-only)
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