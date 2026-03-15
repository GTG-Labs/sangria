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

	// Add secure CORS middleware — only set CORS headers for allowed origins (fail closed)
	app.Use(func(c fiber.Ctx) error {
		origin := c.Get("Origin")

		if isOriginAllowed(origin, allowedOrigins) {
			c.Set("Access-Control-Allow-Origin", origin)
			c.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			c.Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}

		if c.Method() == "OPTIONS" {
			return c.SendStatus(200)
		}

		return c.Next()
	})

	app.Get("/", func(c fiber.Ctx) error {
		return c.SendString("Hello, Sangria!")
	})

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

	log.Fatal(app.Listen(":8080"))
}
