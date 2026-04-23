package routes

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/adminHandlers"
	"sangria/backend/auth"
	"sangria/backend/config"
	"sangria/backend/ratelimit"
)

func RegisterAdminRoutes(app *fiber.App, pool *pgxpool.Pool) {
	// Per-admin limiter runs after auth so it keys by WorkOS user ID.
	admin := app.Group("/admin",
		auth.WorkosAuthMiddleware,
		auth.RequireAdmin(pool),
		ratelimit.PerUserLimiter(config.RateLimit.AdminPerMin, "admin-per-user"),
	)

	admin.Get("/me", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{"admin": true})
	})

	admin.Get("/transactions", adminHandlers.GetAllTransactions(pool))
	admin.Get("/transactions/:id/ledger", adminHandlers.GetTransactionLedger(pool))

	admin.Post("/wallets/pool", adminHandlers.CreateWalletPool(pool))
	admin.Post("/treasury/fund", adminHandlers.FundTreasury(pool))

	// Withdrawal management
	admin.Post("/withdrawals/:id/approve", adminHandlers.ApproveWithdrawal(pool))
	admin.Post("/withdrawals/:id/reject", adminHandlers.RejectWithdrawal(pool))
	admin.Post("/withdrawals/:id/complete", adminHandlers.CompleteWithdrawal(pool))
	admin.Post("/withdrawals/:id/fail", adminHandlers.FailWithdrawal(pool))
	admin.Get("/withdrawals", adminHandlers.ListAllWithdrawals(pool))
}
