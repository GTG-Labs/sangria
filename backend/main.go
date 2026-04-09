package main

import (
	"context"
	"log"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangrianet/backend/adminHandlers"
	"sangrianet/backend/auth"
	"sangrianet/backend/config"
	"sangrianet/backend/merchantHandlers"
	"sangrianet/backend/utils"
)

func main() {
	config.LoadEnvironment()

	if err := config.SetupWorkOS(); err != nil {
		log.Fatalf("Failed to setup WorkOS: %v", err)
	}

	ctx := context.Background()
	pool, err := config.ConnectDatabase(ctx)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	app := fiber.New()
	utils.SetupCORSMiddleware(app)
	setupRoutes(app, pool)

	log.Fatal(app.Listen(":8080"))
}

func setupRoutes(app *fiber.App, pool *pgxpool.Pool) {
	// Root endpoint
	app.Get("/", func(c fiber.Ctx) error {
		return c.SendString("Hello, Sangria!")
	})

	// User endpoints (WorkOS JWT auth)
	app.Post("/users", auth.WorkosAuthMiddleware, auth.CreateUser(pool))
	app.Get("/transactions", auth.WorkosAuthMiddleware, merchantHandlers.GetUserTransactions(pool))

	// API Key management (WorkOS JWT auth)
	apiKeysGroup := app.Group("/api-keys", auth.WorkosAuthMiddleware)
	apiKeysGroup.Get("/", auth.ListAPIKeys(pool))
	apiKeysGroup.Delete("/:id", auth.DeleteAPIKey(pool))

	// === MERCHANT ENDPOINTS ===
	// These are for merchants who already HAVE API keys and want to use them.
	// Uses API key authentication (sg_live_xxx or sg_test_xxx).
	apiKeyMiddleware := auth.APIKeyAuthMiddleware(pool)

	// Payment endpoints (API key auth)
	app.Post("/v1/generate-payment", apiKeyMiddleware, merchantHandlers.GeneratePayment(pool))
	app.Post("/v1/settle-payment", apiKeyMiddleware, merchantHandlers.SettlePayment(pool))

	// Create merchant API key — any authenticated user can do this from the dashboard.
	app.Post("/merchants", auth.WorkosAuthMiddleware, adminHandlers.CreateMerchantAPIKey(pool))

	// === ADMIN ENDPOINTS === (WorkOS JWT + admin API key + admin role)
	// Double-gated: requires a valid WorkOS JWT, the X-Admin-Key header
	// matching ADMIN_API_KEY env var, AND role = "admin" in the database.
	adminMiddleware := auth.RequireAdmin(pool)
	app.Post("/wallets/pool", auth.WorkosAuthMiddleware, adminMiddleware, adminHandlers.CreateWalletPool(pool))
}