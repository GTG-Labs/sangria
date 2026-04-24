package auth

import (
	"crypto/subtle"
	"encoding/json"
	"strings"

	"github.com/gofiber/fiber/v3"
)

// CSRFMiddleware validates CSRF tokens for state-changing operations
func CSRFMiddleware() fiber.Handler {
	return func(c fiber.Ctx) error {
		// Only validate CSRF for state-changing methods
		method := c.Method()
		if method != "POST" && method != "PUT" && method != "DELETE" && method != "PATCH" {
			return c.Next()
		}

		// Get CSRF token from cookie (server-side stored)
		storedToken := GetCSRFTokenFromCookie(c)
		if storedToken == "" {
			return c.Status(403).JSON(fiber.Map{
				"error":      "Missing CSRF token",
				"error_code": "CSRF_TOKEN_MISSING",
				"action":     "refresh_token", // Hint for frontend recovery
			})
		}

		// Get submitted CSRF token from request
		var submittedToken string

		// Try to get token from X-CSRF-Token header first (standard approach)
		submittedToken = c.Get("X-CSRF-Token")

		// Fallback: try to get from JSON body
		if submittedToken == "" {
			contentType := c.Get("Content-Type")
			if strings.HasPrefix(contentType, "application/json") {
				// Clone body to avoid consumption issues
				bodyBytes := make([]byte, len(c.Body()))
				copy(bodyBytes, c.Body())

				var body map[string]interface{}
				if err := json.Unmarshal(bodyBytes, &body); err == nil {
					if token, ok := body["csrf_token"].(string); ok {
						submittedToken = token
					}
				}
			} else {
				// Fallback: try to get from form data
				submittedToken = c.FormValue("csrf_token")
			}
		}

		if submittedToken == "" {
			return c.Status(403).JSON(fiber.Map{
				"error":      "CSRF token required",
				"error_code": "CSRF_TOKEN_REQUIRED",
				"action":     "refresh_token",
			})
		}

		// Timing-safe comparison to prevent timing attacks
		if !isValidCSRFToken(storedToken, submittedToken) {
			return c.Status(403).JSON(fiber.Map{
				"error":      "Invalid CSRF token",
				"error_code": "CSRF_TOKEN_INVALID",
				"action":     "refresh_token",
			})
		}

		return c.Next()
	}
}

// isValidCSRFToken performs a timing-safe comparison of CSRF tokens.
func isValidCSRFToken(stored, submitted string) bool {
	storedBytes := []byte(stored)
	submittedBytes := []byte(submitted)

	if len(submittedBytes) != len(storedBytes) {
		// Dummy compare so length-mismatch takes the same time as the real path.
		_ = subtle.ConstantTimeCompare(storedBytes, storedBytes)
		return false
	}

	return subtle.ConstantTimeCompare(storedBytes, submittedBytes) == 1
}
