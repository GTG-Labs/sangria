package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"slices"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/joho/godotenv"
	"github.com/workos/workos-go/v4/pkg/usermanagement"

	"sangrianet/backend/adminHandlers"
	"sangrianet/backend/auth"
	dbengine "sangrianet/backend/dbEngine"
	"sangrianet/backend/merchantHandlers"
)

// getallowedOrigins parses the ALLOWED_ORIGINS environment variable
func getallowedOrigins() []string {
	allowedOriginsEnv := os.Getenv("ALLOWED_ORIGINS")
	if allowedOriginsEnv == "" {
		log.Println("Warning: ALLOWED_ORIGINS not set, defaulting to localhost:3000")
		return []string{"http://localhost:3000"}
	}

	// Split by comma and trim whitespace
	origins := strings.Split(allowedOriginsEnv, ",")
	for i, origin := range origins {
		origins[i] = strings.TrimSpace(origin)
	}

	return origins
}

// isOriginAllowed checks if the given origin is in the allowlist
func isOriginAllowed(origin string, allowedOrigins []string) bool {
	if origin == "" {
		return false
	}

	return slices.Contains(allowedOrigins, origin)
}

func main() {
	godotenv.Load()

	// WorkOS configuration
	workosAPIKey := os.Getenv("WORKOS_API_KEY")
	if workosAPIKey == "" {
		log.Fatal("WORKOS_API_KEY environment variable is required")
	}
	workosClientID := os.Getenv("WORKOS_CLIENT_ID")
	if workosClientID == "" {
		log.Fatal("WORKOS_CLIENT_ID environment variable is required")
	}
	usermanagement.SetAPIKey(workosAPIKey)

	// Initialize JWKS cache
	if err := auth.InitJWKSCache(workosClientID); err != nil {
		log.Fatalf("Failed to initialize JWKS cache: %v", err)
	}

	ctx := context.Background()

	connStr := os.Getenv("DATABASE_URL")
	if connStr == "" {
		log.Fatal("DATABASE_URL is not set")
	}

	pool, err := dbengine.Connect(ctx, connStr)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	log.Println("Connected to database")

	app := fiber.New()

	// Configure allowed origins from environment
	allowedOrigins := getallowedOrigins()

	// Add secure CORS middleware — only set CORS headers for allowed origins (fail closed)
	app.Use(func(c fiber.Ctx) error {
		origin := c.Get("Origin")

		if isOriginAllowed(origin, allowedOrigins) {
			c.Set("Access-Control-Allow-Origin", origin)
			c.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			c.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
		}

		if c.Method() == "OPTIONS" {
			return c.SendStatus(200)
		}

		return c.Next()
	})

	app.Get("/", func(c fiber.Ctx) error {
		return c.SendString("Hello, Sangria!")
	})

	// --- User endpoints (WorkOS JWT auth) ---
	app.Post("/users", auth.WorkosAuthMiddleware, func(c fiber.Ctx) error {
		user := c.Locals("workos_user").(auth.WorkOSUser)

		if user.ID == "" {
			log.Printf("User missing WorkOS ID: %+v", user)
			return c.Status(500).JSON(fiber.Map{"error": "Invalid user session"})
		}

		owner := user.Email
		if user.FirstName != "" && user.LastName != "" {
			owner = fmt.Sprintf("%s %s", user.FirstName, user.LastName)
		}

		u, err := dbengine.UpsertUser(c.Context(), pool, owner, user.ID)
		if err != nil {
			log.Printf("upsert user error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create user"})
		}

		return c.Status(201).JSON(u)
	})

	// --- API Key management (WorkOS JWT auth) ---
	apiKeysGroup := app.Group("/api-keys", auth.WorkosAuthMiddleware)

	// GET /api-keys — list user's API keys
	apiKeysGroup.Get("/", func(c fiber.Ctx) error {
		user := c.Locals("workos_user").(auth.WorkOSUser)

		apiKeys, err := auth.GetAPIKeysByUserID(c.Context(), pool, user.ID)
		if err != nil {
			log.Printf("Failed to get API keys for user %s: %v", user.ID, err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve API keys"})
		}

		// Remove sensitive data before returning
		for i := range apiKeys {
			apiKeys[i].APIKey = "" // Never expose the hash
		}

		return c.JSON(apiKeys)
	})

	// NOTE: Use POST /merchants to create merchant API keys instead.
	// POST /api-keys creation is disabled — all key creation goes through
	// the merchant endpoint which also sets up the USDC LIABILITY account.

	// DELETE /api-keys/:id — revoke/delete API key
	apiKeysGroup.Delete("/:id", func(c fiber.Ctx) error {
		user := c.Locals("workos_user").(auth.WorkOSUser)
		keyID := c.Params("id")

		if keyID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "API key ID is required"})
		}

		err := auth.RevokeAPIKey(c.Context(), pool, keyID, user.ID)
		if err != nil {
			log.Printf("Failed to revoke API key %s for user %s: %v", keyID, user.ID, err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to revoke API key"})
		}

		return c.Status(204).Send(nil)
	})

	// --- Merchant endpoints (API key auth) ---
	apiKeyMiddleware := auth.APIKeyAuthMiddleware(pool)
	merchantGroup := app.Group("/merchants", apiKeyMiddleware)
	merchantGroup.Get("/profile", merchantHandlers.GetMerchantProfile(pool))
	merchantGroup.Get("/balance", merchantHandlers.GetMerchantBalance(pool))

	// --- Payment endpoints (API key auth) ---
	app.Post("/payments/generate-payment", apiKeyMiddleware, merchantHandlers.GeneratePayment(pool))
	app.Post("/payments/settle-payment", apiKeyMiddleware, merchantHandlers.SettlePayment(pool))

	// --- Facilitator endpoints (x402 protocol, API key auth) ---
	facilitatorGroup := app.Group("/facilitator", apiKeyMiddleware)

	// POST /facilitator/verify — verify a payment authorization
	facilitatorGroup.Post("/verify", func(c fiber.Ctx) error {
		type VerifyPaymentRequest struct {
			PaymentHeader string                 `json:"payment_header"`
			Requirements  map[string]interface{} `json:"requirements"`
		}

		var req VerifyPaymentRequest
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		// Payment verification logic not yet implemented
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
			"error": "Payment verification functionality not yet implemented",
			"code":  "NOT_IMPLEMENTED",
		})
	})

	// POST /facilitator/settle — settle a verified payment
	facilitatorGroup.Post("/settle", func(c fiber.Ctx) error {
		type SettlePaymentRequest struct {
			PaymentHeader string                 `json:"payment_header"`
			Requirements  map[string]interface{} `json:"requirements"`
		}

		var req SettlePaymentRequest
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		// Payment settlement logic not yet implemented
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
			"error": "Payment settlement functionality not yet implemented",
			"code":  "NOT_IMPLEMENTED",
		})
	})

	// --- Admin endpoints (WorkOS JWT auth) ---
	// TODO: Add admin role authorization. Currently any authenticated user can
	// call these endpoints. Decide on an admin mechanism (e.g., is_admin flag on
	// users, WorkOS roles/permissions, or internal secret) and add middleware to
	// restrict access.
	app.Post("/merchants", auth.WorkosAuthMiddleware, adminHandlers.CreateMerchantAPIKey(pool))
	app.Post("/wallets/pool", auth.WorkosAuthMiddleware, adminHandlers.CreateWalletPool(pool))

	log.Fatal(app.Listen(":8080"))
}
