package auth

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/gofiber/fiber/v3"
)

// IsDevelopmentEnv is the env-check used by cookie/security helpers in this
// package. It's a package-level function pointer so the config package can
// override it at startup (keeping auth ← config dependency direction intact).
// Default returns false (assume production) until config wires it up.
var IsDevelopmentEnv = func() bool { return false }

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
	if IsDevelopmentEnv() {
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
