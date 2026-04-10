package routes

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/adminHandlers"
	"sangria/backend/auth"
)

func RegisterAdminRoutes(app *fiber.App, pool *pgxpool.Pool) {
	admin := app.Group("/admin", auth.WorkosAuthMiddleware, auth.RequireAdmin(pool))

	admin.Post("/wallets/pool", adminHandlers.CreateWalletPool(pool))
	admin.Post("/treasury/fund", adminHandlers.FundTreasury(pool))
}
