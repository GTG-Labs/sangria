package utils

import (
	"log/slog"
	"os"
	"slices"
	"strings"

	"github.com/gofiber/fiber/v3"
)

// GetAllowedOrigins parses the ALLOWED_ORIGINS environment variable
func GetAllowedOrigins() []string {
	allowedOriginsEnv := os.Getenv("ALLOWED_ORIGINS")
	if allowedOriginsEnv == "" {
		slog.Warn("ALLOWED_ORIGINS not set, defaulting to localhost:3000")
		return []string{"http://localhost:3000"}
	}

	origins := strings.Split(allowedOriginsEnv, ",")
	for i, origin := range origins {
		origins[i] = strings.TrimSpace(origin)
	}

	return origins
}

// IsOriginAllowed checks if the given origin is in the allowlist
func IsOriginAllowed(origin string, allowedOrigins []string) bool {
	if origin == "" {
		return false
	}

	return slices.Contains(allowedOrigins, origin)
}

// SetupCORSMiddleware configures CORS for the fiber app
func SetupCORSMiddleware(app *fiber.App) {
	allowedOrigins := GetAllowedOrigins()

	app.Use(func(c fiber.Ctx) error {
		origin := c.Get("Origin")

		if IsOriginAllowed(origin, allowedOrigins) {
			c.Set("Access-Control-Allow-Origin", origin)
			c.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
			c.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, X-CSRF-Token")
			c.Set("Access-Control-Allow-Credentials", "true") // Required for cookies
			c.Set("Access-Control-Max-Age", "86400") // 24 hours
			c.Set("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers")

		}

		if c.Method() == "OPTIONS" {
			if !IsOriginAllowed(origin, allowedOrigins) {
				return c.SendStatus(403)
			}
			return c.SendStatus(204)
		}

		return c.Next()
	})
}