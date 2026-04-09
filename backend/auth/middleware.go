package auth

import (
	"crypto/subtle"
	"log"
	"os"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/workos/workos-go/v4/pkg/usermanagement"

	dbengine "sangria/backend/dbEngine"
)

// WorkOSUser contains user information from a validated session.
type WorkOSUser struct {
	ID        string
	Email     string
	FirstName string
	LastName  string
}

// WorkosAuthMiddleware validates WorkOS JWT session tokens and extracts user info.
func WorkosAuthMiddleware(c fiber.Ctx) error {
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
	userID, err := VerifyWorkOSToken(c.Context(), token)
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

// APIKeyAuthMiddleware validates API keys for merchant authentication.
func APIKeyAuthMiddleware(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
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
		merchantKey, err := AuthenticateAPIKey(c.Context(), pool, apiKey)
		if err != nil {
			log.Printf("API key authentication failed: %v", err)
			return c.Status(401).JSON(fiber.Map{"error": "Invalid API key"})
		}

		// Store the authenticated merchant info in context
		c.Locals("merchant_api_key", merchantKey)
		c.Locals("merchant_user_id", merchantKey.UserID)

		return c.Next()
	}
}

// RequireAdmin is a middleware that enforces admin access.
// Must run AFTER WorkosAuthMiddleware (needs workos_user in locals).
// Requires both:
//  1. A valid X-Admin-Key header matching the ADMIN_API_KEY env var
//  2. The user's role == "admin" in the database
func RequireAdmin(pool *pgxpool.Pool) fiber.Handler {
	adminKey := os.Getenv("ADMIN_API_KEY")

	return func(c fiber.Ctx) error {
		// Check admin API key header.
		if adminKey == "" {
			log.Printf("ADMIN_API_KEY env var not set — admin endpoints are disabled")
			return c.Status(503).JSON(fiber.Map{"error": "Admin access not configured"})
		}

		providedKey := c.Get("X-Admin-Key")
		if providedKey == "" || subtle.ConstantTimeCompare([]byte(providedKey), []byte(adminKey)) != 1 {
			return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
		}

		// Check user role in database.
		user := c.Locals("workos_user").(WorkOSUser)
		dbUser, err := dbengine.GetUserByWorkosID(c.Context(), pool, user.ID)
		if err != nil {
			log.Printf("admin role check: database lookup failed for user %s: %v", user.ID, err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		if dbUser.Role != "admin" {
			return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
		}

		// Store the full DB user in locals for handlers to use.
		c.Locals("db_user", dbUser)

		return c.Next()
	}
}