package auth

import (
	"log"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangrianet/backend/dbEngine"
)

// ListUserTransactions handles GET /transactions
// Returns all transactions where the authenticated user received payment
func ListUserTransactions(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		// Get authenticated user from WorkOS middleware
		user := c.Locals("workos_user").(WorkOSUser)

		transactions, err := dbengine.GetUserTransactions(c.Context(), pool, user.ID)
		if err != nil {
			log.Printf("Failed to fetch transactions for user %s: %v", user.ID, err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve transactions"})
		}

		return c.JSON(transactions)
	}
}
