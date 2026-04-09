package merchantHandlers

import (
	"log"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangrianet/backend/auth"
	dbengine "sangrianet/backend/dbEngine"
)

// GetUserTransactions handles GET /transactions
// Returns all transactions for the authenticated dashboard user (WorkOS JWT)
func GetUserTransactions(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		// Get authenticated user from WorkOS middleware
		user := c.Locals("workos_user").(auth.WorkOSUser)

		transactions, err := dbengine.GetUserTransactions(c.Context(), pool, user.ID)
		if err != nil {
			log.Printf("Failed to fetch transactions for user %s: %v", user.ID, err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve transactions"})
		}

		return c.JSON(transactions)
	}
}
