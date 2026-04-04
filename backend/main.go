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
	"sangrianet/backend/x402Handlers"
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

	// API Key management (WorkOS JWT auth)
	apiKeysGroup := app.Group("/api-keys", auth.WorkosAuthMiddleware)
	apiKeysGroup.Get("/", auth.ListAPIKeys(pool))
	apiKeysGroup.Delete("/:id", auth.DeleteAPIKey(pool))

	// === MERCHANT ENDPOINTS ===
	// These are for merchants who already HAVE API keys and want to use them.
	// Uses API key authentication (sg_live_xxx or sg_test_xxx).
	//
	// IMPORTANT: We use /merchant/* (singular) to avoid conflicts with the admin
	// /merchants (plural) endpoint below that CREATES merchant API keys.
	//
	// Example flow:
	// 1. Admin creates API key via POST /merchants
	// 2. Merchant uses that API key to call GET /merchant/profile
	apiKeyMiddleware := auth.APIKeyAuthMiddleware(pool)
	app.Get("/merchant/profile", apiKeyMiddleware, merchantHandlers.GetMerchantProfile(pool))
	app.Get("/merchant/balance", apiKeyMiddleware, merchantHandlers.GetMerchantBalance(pool))

	// Payment endpoints (API key auth)
	app.Post("/payments/generate-payment", apiKeyMiddleware, merchantHandlers.GeneratePayment(pool))
	app.Post("/payments/settle-payment", apiKeyMiddleware, merchantHandlers.SettlePayment(pool))

	// Facilitator endpoints (API key auth)
	facilitatorGroup := app.Group("/facilitator", apiKeyMiddleware)

	// POST /facilitator/verify — verify a payment authorization
	facilitatorGroup.Post("/verify", x402Handlers.VerifyPayment(pool))

	// POST /facilitator/settle — settle a verified payment
	facilitatorGroup.Post("/settle", x402Handlers.SettlePayment(pool))

	// === ADMIN ENDPOINTS === (WorkOS JWT auth)
	// These are for admins to MANAGE the system (create API keys, manage wallets, etc.)
	// Uses WorkOS JWT authentication (admin must be logged in via WorkOS).
	//
	// IMPORTANT: /merchants (plural) is for CREATING merchant API keys, not for
	// merchants using their keys. Merchants using keys should call /merchant/* above.
	//
	// TODO: Add admin role authorization. Currently any authenticated user can
	// call these endpoints. Decide on an admin mechanism (e.g., is_admin flag on
	// users, WorkOS roles/permissions, or internal secret) and add middleware to
	// restrict access.
	//
	// Example flow:
	// 1. Admin logs in via WorkOS → gets JWT token
	// 2. Admin calls POST /merchants with JWT → creates API key for a merchant
	// 3. Returns the API key (shown only once for security)
	app.Post("/merchants", auth.WorkosAuthMiddleware, adminHandlers.CreateMerchantAPIKey(pool))
	app.Post("/wallets/pool", auth.WorkosAuthMiddleware, adminHandlers.CreateWalletPool(pool))
}