package routes

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/adminHandlers"
	"sangria/backend/auth"
	"sangria/backend/merchantHandlers"
)

func RegisterJWTRoutes(app *fiber.App, pool *pgxpool.Pool) {
	internal := app.Group("/internal", auth.WorkosAuthMiddleware)

	internal.Post("/users", auth.CreateUser(pool))
	internal.Get("/balance", merchantHandlers.GetMerchantBalance(pool))
	internal.Get("/transactions", merchantHandlers.GetMerchantTransactions(pool))
	internal.Post("/merchants", adminHandlers.CreateMerchantAPIKey(pool))

	apiKeys := internal.Group("/api-keys")
	apiKeys.Get("/", auth.ListAPIKeys(pool))
	apiKeys.Delete("/:id", auth.DeleteAPIKey(pool))

	// Withdrawal endpoints — user picks which merchant account to withdraw from.
	internal.Post("/withdrawals", merchantHandlers.RequestWithdrawal(pool))
	internal.Get("/withdrawals", merchantHandlers.ListWithdrawals(pool))
}
