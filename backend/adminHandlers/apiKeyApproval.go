package adminHandlers

import (
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/auth"
	dbengine "sangria/backend/dbEngine"
)

// ApproveAPIKey handles POST /api-keys/:id/approve.
// Changes a pending API key to active status (admin-only).
func ApproveAPIKey(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		// Get authenticated user from middleware context
		user, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		keyID := c.Params("id")
		if keyID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "API key ID is required"})
		}

		rowsAffected, err := dbengine.UpdatePendingMerchantStatus(c.Context(), pool, keyID, user.ID, dbengine.APIKeyStatusActive)
		if err != nil {
			slog.Error("approve API key", "key_id", keyID, "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to approve API key"})
		}

		if rowsAffected == 0 {
			return c.Status(404).JSON(fiber.Map{"error": "pending API key not found"})
		}

		return c.JSON(fiber.Map{
			"message": "API key approved and activated",
		})
	}
}

// RejectAPIKey handles POST /api-keys/:id/reject.
// Changes a pending API key to inactive status (admin-only).
func RejectAPIKey(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		// Get authenticated user from middleware context
		user, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		keyID := c.Params("id")
		if keyID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "API key ID is required"})
		}

		rowsAffected, err := dbengine.UpdatePendingMerchantStatus(c.Context(), pool, keyID, user.ID, dbengine.APIKeyStatusInactive)
		if err != nil {
			slog.Error("reject API key", "key_id", keyID, "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to reject API key"})
		}

		if rowsAffected == 0 {
			return c.Status(404).JSON(fiber.Map{"error": "pending API key not found"})
		}

		return c.JSON(fiber.Map{
			"message": "API key rejected and deactivated",
		})
	}
}