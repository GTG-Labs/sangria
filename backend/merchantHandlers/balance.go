package merchantHandlers

import (
	"fmt"
	"log"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangria/backend/dbEngine"
)

// GetMerchantBalance handles GET /merchant/balance.
// Returns the authenticated merchant's virtual USD balance.
func GetMerchantBalance(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		merchant := c.Locals("merchant_api_key").(*dbengine.Merchant)

		balance, err := dbengine.GetMerchantBalance(c.Context(), pool, merchant.ID)
		if err != nil {
			log.Printf("get merchant balance: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to get balance"})
		}

		// Convert microunits to display string using integer math (no float rounding).
		// 1 USD = 1,000,000 microunits. Preserves full 6-digit precision.
		sign := ""
		abs := balance
		if balance < 0 {
			sign = "-"
			abs = -balance
		}
		whole := abs / 1_000_000
		frac := abs % 1_000_000
		displayBalance := fmt.Sprintf("%s$%d.%06d", sign, whole, frac)

		return c.Status(200).JSON(fiber.Map{
			"balance":         balance,
			"currency":        "USD",
			"display_balance": displayBalance,
		})
	}
}
