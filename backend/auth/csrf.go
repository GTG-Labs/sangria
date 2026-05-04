package auth

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/gofiber/fiber/v3"
)

// IsDevelopmentEnv toggles dev-mode relaxations (SameSite=Lax, non-secure) in
// this package's cookie helpers. Startup contract: main.go sets this once after
// config.LoadLoggingConfig and before any cookie-setting handler is registered.
// Defaults to false so unwired reads get the production posture.
var IsDevelopmentEnv bool

// CSRFToken represents a CSRF token with expiration
type CSRFToken struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

// GenerateCSRFToken creates a cryptographically secure CSRF token
func GenerateCSRFToken() (string, error) {
	bytes := make([]byte, 32) // 256 bits
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// SetCSRFTokenCookie sets a secure CSRF token cookie
func SetCSRFTokenCookie(c fiber.Ctx, token string) {
	// Production defaults: strict security
	sameSite := "Strict"
	secure := c.Protocol() == "https"

	// Development settings: relaxed for local development
	if IsDevelopmentEnv {
		sameSite = "Lax" // Allow cross-origin for localhost frontend
		secure = false   // Allow HTTP in development
	}

	c.Cookie(&fiber.Cookie{
		Name:     "csrf_token",
		Value:    token,
		Expires:  time.Now().Add(time.Hour), // 1 hour expiration
		HTTPOnly: false, // MUST be false so frontend can read it
		Secure:   secure,
		SameSite: sameSite,
		Path:     "/",
		Domain:   "", // Empty domain allows cross-port cookies on localhost
	})
}

// GetCSRFTokenFromCookie retrieves CSRF token from cookie
func GetCSRFTokenFromCookie(c fiber.Ctx) string {
	return c.Cookies("csrf_token")
}

// CSRFTokenHandler generates and returns a new CSRF token
func CSRFTokenHandler() fiber.Handler {
	return func(c fiber.Ctx) error {
		// Generate new CSRF token
		token, err := GenerateCSRFToken()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to generate CSRF token",
			})
		}

		// Set secure cookie
		SetCSRFTokenCookie(c, token)

		// Return token to client
		return c.JSON(fiber.Map{
			"csrf_token": token,
		})
	}
}
