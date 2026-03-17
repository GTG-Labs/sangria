package merchantPaymentHandler

import (
	"fmt"
	"log"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangrianet/backend/dbEngine"
)

// GetMerchantBalance handles GET /merchants/balance.
// Returns the authenticated merchant's virtual USDC balance.
func GetMerchantBalance(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		merchant := c.Locals("merchant_api_key").(*dbengine.Merchant)

		balance, err := dbengine.GetMerchantBalance(c.Context(), pool, merchant.ID)
		if err != nil {
			log.Printf("get merchant balance: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to get balance"})
		}

		// Convert microunits to display dollars (1 USDC = 1,000,000 microunits).
		displayBalance := fmt.Sprintf("$%.2f", float64(balance)/1_000_000)

		return c.Status(200).JSON(fiber.Map{
			"balance":         balance,
			"currency":        "USDC",
			"display_balance": displayBalance,
		})
	}
}
