package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/joho/godotenv"
	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jwt"
	"github.com/workos/workos-go/v4/pkg/usermanagement"

	dbengine "sangrianet/backend/dbEngine"
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

	// Parse and verify JWT token
	token, err := jwt.ParseString(tokenStr, jwt.WithKeySet(keySet), jwt.WithValidate(true))
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
	log.Println("Connected to database")

	app := fiber.New()

	// Configure allowed origins from environment
	allowedOrigins := getallowedOrigins()

	// Add secure CORS middleware
	app.Use(func(c fiber.Ctx) error {
		// Get the Origin header from the request
		origin := c.Get("Origin")

		// Check if origin is in allowlist
		if isOriginAllowed(origin, allowedOrigins) {
			c.Set("Access-Control-Allow-Origin", origin)
		}
		// If origin not allowed, don't set CORS headers (fail closed)

		c.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if c.Method() == "OPTIONS" {
			return c.SendStatus(200)
		}

		return c.Next()
	})

	app.Get("/", func(c fiber.Ctx) error {
		return c.SendString("Hello, Sangria!")
	})

	// POST /accounts — create an account (requires authentication)
	app.Post("/accounts", workosAuthMiddleware, func(c fiber.Ctx) error {
		// Get authenticated user from middleware
		user := c.Locals("workos_user").(WorkOSUser)

		// Validate user has WorkOS ID (should never be empty due to middleware, but defensive programming)
		if user.ID == "" {
			log.Printf("User missing WorkOS ID: %+v", user)
			return c.Status(500).JSON(fiber.Map{"error": "Invalid user session"})
		}

		// Generate display name from authenticated user data
		owner := user.Email
		if user.FirstName != "" && user.LastName != "" {
			owner = fmt.Sprintf("%s %s", user.FirstName, user.LastName)
		}

		// Generate deterministic account number from WorkOS user ID
		accountNumber := fmt.Sprintf("ACC-%s", strings.ToUpper(user.ID[:8]))

		// Create account using verified user data only
		account, err := dbengine.InsertAccount(c.Context(), pool, accountNumber, owner, user.ID)
		if err != nil {
			log.Printf("insert error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create account"})
		}

		return c.Status(201).JSON(account)
	})

	// GET /accounts — list all accounts
	app.Get("/accounts", func(c fiber.Ctx) error {
		accounts, err := dbengine.GetAllAccounts(c.Context(), pool)
		if err != nil {
			log.Printf("query error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch accounts"})
		}

		return c.JSON(accounts)
	})

	// POST /transactions — create a transaction
	app.Post("/transactions", func(c fiber.Ctx) error {
		fromStr := c.Query("from_account")
		toStr := c.Query("to_account")
		value := c.Query("value")
		if fromStr == "" || toStr == "" || value == "" {
			return c.Status(400).JSON(fiber.Map{"error": "from_account, to_account, and value are required"})
		}

		fromAccount, err := strconv.ParseInt(fromStr, 10, 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "from_account must be an integer"})
		}
		toAccount, err := strconv.ParseInt(toStr, 10, 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "to_account must be an integer"})
		}

		txn, err := dbengine.InsertTransaction(c.Context(), pool, fromAccount, toAccount, value)
		if err != nil {
			log.Printf("insert error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create transaction"})
		}

		return c.Status(201).JSON(txn)
	})

	// GET /transactions — list all transactions
	app.Get("/transactions", func(c fiber.Ctx) error {
		txns, err := dbengine.GetAllTransactions(c.Context(), pool)
		if err != nil {
			log.Printf("query error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch transactions"})
		}

		return c.JSON(txns)
	})

	log.Fatal(app.Listen(":8080"))
}
