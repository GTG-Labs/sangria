package auth

import (
	"log/slog"
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
		slog.Error("JWT validation failed", "error", err)
		return c.Status(401).JSON(fiber.Map{"error": "Invalid or expired session token"})
	}

	// Get user info from WorkOS using the validated user ID
	user, err := usermanagement.GetUser(c.Context(), usermanagement.GetUserOpts{
		User: userID,
	})
	if err != nil {
		slog.Error("WorkOS user lookup failed", "user_id", userID, "error", err)
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
			slog.Error("API key authentication failed", "error", err)
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
// Checks that the authenticated user exists in the admins table.
func RequireAdmin(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		isAdmin, err := dbengine.IsAdmin(c.Context(), pool, user.ID)
		if err != nil {
			slog.Error("admin check: database lookup failed", "user_id", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		if !isAdmin {
			return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
		}

		return c.Next()
	}
}