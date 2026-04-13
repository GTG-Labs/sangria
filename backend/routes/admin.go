package routes

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/adminHandlers"
	"sangria/backend/auth"
)

func RegisterAdminRoutes(app *fiber.App, pool *pgxpool.Pool) {
	admin := app.Group("/admin", auth.WorkosAuthMiddleware, auth.RequireAdmin(pool))

	admin.Get("/me", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{"admin": true})
	})

	admin.Post("/wallets/pool", adminHandlers.CreateWalletPool(pool))
	admin.Post("/treasury/fund", adminHandlers.FundTreasury(pool))

	// Withdrawal management
	admin.Post("/withdrawals/:id/approve", adminHandlers.ApproveWithdrawal(pool))
	admin.Post("/withdrawals/:id/reject", adminHandlers.RejectWithdrawal(pool))
	admin.Post("/withdrawals/:id/complete", adminHandlers.CompleteWithdrawal(pool))
	admin.Post("/withdrawals/:id/fail", adminHandlers.FailWithdrawal(pool))
	admin.Get("/withdrawals", adminHandlers.ListAllWithdrawals(pool))
}
