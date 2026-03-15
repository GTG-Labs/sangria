package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jwt"
	"github.com/workos/workos-go/v4/pkg/usermanagement"

	dbengine "sangrianet/backend/dbEngine"
	handlers "sangrianet/backend/handlers"
	"sangrianet/backend/merchantPaymentHandler"
)

// WorkOSUser contains user information from validated session
type WorkOSUser struct {
	ID        string
	Email     string
	FirstName string
	LastName  string
}

// Global JWKS cache for WorkOS JWT validation
var jwksCache *jwk.Cache

// Global database pool
var globalPool *pgxpool.Pool

// workosAuthMiddleware validates WorkOS JWT session tokens and extracts user info
func workosAuthMiddleware(c fiber.Ctx) error {
	// Get Authorization header containing JWT token
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Authorization header required"})
	}

	// Extract bearer token
	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token == authHeader || token == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Bearer token required"})
	}

	// Validate JWT token and extract user ID
	userID, err := verifyWorkOSToken(c.Context(), token)
	if err != nil {
		log.Printf("JWT validation failed: %v", err)
		return c.Status(401).JSON(fiber.Map{"error": "Invalid or expired session token"})
	}

	// Get user info from WorkOS using the validated user ID
	user, err := usermanagement.GetUser(c.Context(), usermanagement.GetUserOpts{
		User: userID,
	})
	if err != nil {
		log.Printf("WorkOS user lookup failed for validated user %s: %v", userID, err)
		return c.Status(401).JSON(fiber.Map{"error": "User session not found"})
	}

	// Store validated user info in context
	c.Locals("workos_user", WorkOSUser{
		ID:        user.ID,
		Email:     user.Email,
		FirstName: user.FirstName,
		LastName:  user.LastName,
	})

	return c.Next()
}

// apiKeyAuthMiddleware validates API keys for merchant authentication
func apiKeyAuthMiddleware(c fiber.Ctx) error {
	// Get API key from Authorization header or X-API-Key header
	var apiKey string

	// Check Authorization header first (Bearer token style)
	authHeader := c.Get("Authorization")
	if authHeader != "" {
		if strings.HasPrefix(authHeader, "Bearer ") {
			apiKey = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}

	// Fall back to X-API-Key header
	if apiKey == "" {
		apiKey = c.Get("X-API-Key")
	}

	if apiKey == "" {
		return c.Status(401).JSON(fiber.Map{"error": "API key required"})
	}

	// Validate and authenticate the API key
	merchantKey, err := handlers.AuthenticateAPIKey(c.Context(), globalPool, apiKey)
	if err != nil {
		log.Printf("API key authentication failed: %v", err)
		return c.Status(401).JSON(fiber.Map{"error": "Invalid API key"})
	}

	// Store the authenticated merchant info in context
	c.Locals("merchant_api_key", merchantKey)
	c.Locals("merchant_user_id", merchantKey.UserID)

	return c.Next()
}

// initJWKSCache initializes the global JWKS cache with proper security settings
func initJWKSCache(clientID string) error {
	// Get JWKS URL for this client
	jwksURL, err := usermanagement.GetJWKSURL(clientID)
	if err != nil {
		return fmt.Errorf("failed to get JWKS URL: %w", err)
	}

	// Create HTTP client with timeout to avoid indefinite hangs
	httpClient := &http.Client{
		Timeout: 10 * time.Second,
	}

	// Initialize JWKS cache with security restrictions
	jwksCache = jwk.NewCache(context.Background())

	// Register the JWKS URL with the cache, using custom HTTP client and fetch whitelist
	jwksCache.Register(jwksURL.String(),
		jwk.WithHTTPClient(httpClient),
		jwk.WithFetchWhitelist(jwk.WhitelistFunc(func(u string) bool {
			// Only allow fetching the expected WorkOS JWKS URL
			return u == jwksURL.String()
		})))

	return nil
}

// verifyWorkOSToken validates a WorkOS JWT token and extracts the user ID
func verifyWorkOSToken(ctx context.Context, tokenStr string) (string, error) {
	clientID := os.Getenv("WORKOS_CLIENT_ID")
	if clientID == "" {
		return "", fmt.Errorf("WORKOS_CLIENT_ID not configured")
	}

	// Get JWKS URL for this client
	jwksURL, err := usermanagement.GetJWKSURL(clientID)
	if err != nil {
		return "", fmt.Errorf("failed to get JWKS URL: %w", err)
	}

	// Get key set from cache (this will automatically fetch/refresh as needed)
	keySet, err := jwksCache.Get(ctx, jwksURL.String())
	if err != nil {
		return "", fmt.Errorf("failed to get JWKS from cache: %w", err)
	}

	// Parse and verify JWT token.
	// WithAcceptableSkew: WorkOS may issue tokens with an `iat` a few seconds
	// ahead of this server's clock, causing "iat not satisfied" rejections.
	// A 5-second window accounts for normal clock drift.
	token, err := jwt.ParseString(tokenStr, jwt.WithKeySet(keySet), jwt.WithValidate(true), jwt.WithAcceptableSkew(5*time.Second))
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired()) {
			return "", fmt.Errorf("token expired, please refresh your session")
		}
		return "", fmt.Errorf("failed to parse/verify token: %w", err)
	}

	// Extract user ID from 'sub' claim
	userID, ok := token.Get("sub")
	if !ok {
		return "", fmt.Errorf("token missing 'sub' claim")
	}

	userIDStr, ok := userID.(string)
	if !ok {
		return "", fmt.Errorf("invalid 'sub' claim type")
	}

	return userIDStr, nil
}

// merchantAPIKeyMiddleware validates a merchant API key from the request
// and stores the resolved Merchant in context locals.
//
// TODO: The API key lookup mechanism is being handled separately.
// Currently this needs a strategy for O(1) bcrypt lookup (e.g. key prefix/identifier).
func merchantAPIKeyMiddleware(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		apiKey := c.Get("X-API-Key")
		if apiKey == "" {
			return c.Status(401).JSON(fiber.Map{"error": "X-API-Key header required"})
		}

		// TODO: Implement merchant lookup by API key.
		// bcrypt hashes can't be used in WHERE clauses, so this needs a
		// prefix/identifier approach or a separate lookup table.
		// For now, this middleware is a placeholder.
		_ = pool
		_ = apiKey

		return c.Status(501).JSON(fiber.Map{"error": "API key authentication not yet implemented"})
	}
}

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
	if err := initJWKSCache(workosClientID); err != nil {
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

	// Set global pool for middleware access
	globalPool = pool

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

	// --- Stub payment routes (no auth / DB required) ---
	merchantPaymentHandler.RegisterRoutes(app)

	// POST /users — register/upsert a user on login (requires authentication)
	app.Post("/users", workosAuthMiddleware, func(c fiber.Ctx) error {
		user := c.Locals("workos_user").(WorkOSUser)

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

	// API Key management endpoints
	apiKeysGroup := app.Group("/api-keys", workosAuthMiddleware)

	// GET /api-keys — list user's API keys
	apiKeysGroup.Get("/", func(c fiber.Ctx) error {
		user := c.Locals("workos_user").(WorkOSUser)

		apiKeys, err := handlers.GetAPIKeysByUserID(c.Context(), pool, user.ID)
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

	// POST /api-keys — create new API key
	apiKeysGroup.Post("/", func(c fiber.Ctx) error {
		user := c.Locals("workos_user").(WorkOSUser)

		type CreateAPIKeyRequest struct {
			Name   string `json:"name"`
			IsLive bool   `json:"is_live"`
		}

		var req CreateAPIKeyRequest
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if req.Name == "" {
			return c.Status(400).JSON(fiber.Map{"error": "API key name is required"})
		}

		if len(req.Name) > 255 {
			return c.Status(400).JSON(fiber.Map{"error": "API key name too long (max 255 characters)"})
		}

		apiKey, fullKey, err := handlers.CreateAPIKey(c.Context(), pool, user.ID, req.Name, req.IsLive)
		if err != nil {
			// Check if it's the max keys error and return appropriate response
			if errors.Is(err, handlers.ErrMaxAPIKeysReached) {
				return c.Status(400).JSON(fiber.Map{"error": "Maximum number of API keys reached (10)"})
			}
			log.Printf("Failed to create API key for user %s: %v", user.ID, err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create API key"})
		}

		// Return the full key only once, and the safe API key object
		response := fiber.Map{
			"api_key": apiKey,
			"key":     fullKey, // This is the only time the full key is returned
		}

		// Remove sensitive data from the api_key object
		apiKey.APIKey = ""

		return c.Status(201).JSON(response)
	})

	// DELETE /api-keys/:id — revoke/delete API key
	apiKeysGroup.Delete("/:id", func(c fiber.Ctx) error {
		user := c.Locals("workos_user").(WorkOSUser)
		keyID := c.Params("id")

		if keyID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "API key ID is required"})
		}

		err := handlers.RevokeAPIKey(c.Context(), pool, keyID, user.ID)
		if err != nil {
			log.Printf("Failed to revoke API key %s for user %s: %v", keyID, user.ID, err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to revoke API key"})
		}

		return c.Status(204).Send(nil)
	})

	// Merchant API endpoints (protected by API key authentication)
	merchantGroup := app.Group("/merchant", apiKeyAuthMiddleware)

	// GET /merchant/profile — get merchant profile using API key
	merchantGroup.Get("/profile", func(c fiber.Ctx) error {
		merchantKey := c.Locals("merchant_api_key").(*dbengine.Merchant)
		userID := c.Locals("merchant_user_id").(string)

		// Get user information
		user, err := dbengine.GetUserByWorkosID(c.Context(), pool, userID)
		if err != nil {
			log.Printf("Failed to get user for API key %s: %v", merchantKey.ID, err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve merchant profile"})
		}

		response := fiber.Map{
			"user": user,
			"api_key": fiber.Map{
				"id":           merchantKey.ID,
				"name":         merchantKey.Name,
				"is_active":    merchantKey.IsActive,
				"last_used_at": merchantKey.LastUsedAt,
				"created_at":   merchantKey.CreatedAt,
			},
		}

		return c.JSON(response)
	})

	// Facilitator endpoints (x402 protocol) - protected by API key authentication
	facilitatorGroup := app.Group("/facilitator", apiKeyAuthMiddleware)

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

	// --- x402 routes ---

	// Merchant API key auth (payments + balance)
	app.Post("/payments/generate-payment", merchantAPIKeyMiddleware(pool), handlers.GeneratePayment(pool))
	app.Post("/payments/settle-payment", merchantAPIKeyMiddleware(pool), handlers.SettlePayment(pool))
	app.Get("/merchants/balance", merchantAPIKeyMiddleware(pool), handlers.GetMerchantBalance(pool))

	// Admin routes (WorkOS JWT auth)
	app.Post("/merchants", workosAuthMiddleware, handlers.CreateMerchant(pool))
	app.Post("/wallets/pool", workosAuthMiddleware, handlers.CreateWalletPool(pool))

	log.Fatal(app.Listen(":8080"))
}
