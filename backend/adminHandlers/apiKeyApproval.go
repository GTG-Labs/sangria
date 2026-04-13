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

		// Check if user is admin of any organization (basic check - could be more specific)
		memberships, err := dbengine.GetUserOrganizations(c.Context(), pool, user.ID)
		if err != nil {
			slog.Error("get user organizations", "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to get user organizations"})
		}

		isAdmin := false
		for _, membership := range memberships {
			if membership.IsAdmin {
				isAdmin = true
				break
			}
		}

		if !isAdmin {
			return c.Status(403).JSON(fiber.Map{"error": "admin access required"})
		}

		// Update the API key status to active
		result, err := pool.Exec(c.Context(),
			`UPDATE merchants SET status = 'active' WHERE id = $1 AND status = 'pending'`,
			keyID,
		)
		if err != nil {
			slog.Error("approve API key", "key_id", keyID, "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to approve API key"})
		}

		if result.RowsAffected() == 0 {
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

		// Check if user is admin of any organization (basic check - could be more specific)
		memberships, err := dbengine.GetUserOrganizations(c.Context(), pool, user.ID)
		if err != nil {
			slog.Error("get user organizations", "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to get user organizations"})
		}

		isAdmin := false
		for _, membership := range memberships {
			if membership.IsAdmin {
				isAdmin = true
				break
			}
		}

		if !isAdmin {
			return c.Status(403).JSON(fiber.Map{"error": "admin access required"})
		}

		// Update the API key status to inactive
		result, err := pool.Exec(c.Context(),
			`UPDATE merchants SET status = 'inactive' WHERE id = $1 AND status = 'pending'`,
			keyID,
		)
		if err != nil {
			slog.Error("reject API key", "key_id", keyID, "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to reject API key"})
		}

		if result.RowsAffected() == 0 {
			return c.Status(404).JSON(fiber.Map{"error": "pending API key not found"})
		}

		return c.JSON(fiber.Map{
			"message": "API key rejected and deactivated",
		})
	}
}