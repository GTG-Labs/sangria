package ratelimit

import (
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/limiter"

	"sangria/backend/auth"
	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
)

// RateLimit helpers build Fiber limiter middleware scoped to different
// identities. Every limit is a fixed 1-minute window with an in-memory
// counter (one backend instance assumed; swap the Storage when scaling out).
// See CRITICAL_SECURITY_ISSUES.md § H1 for the threat model.

// skipIfDisabled returns a Next function that bypasses the limiter entirely
// when RATE_LIMIT_DISABLED=true. Emergency kill switch.
func skipIfDisabled(c fiber.Ctx) bool {
	return config.RateLimit.Disabled
}

// clientIP returns the unspoofable client IP on Railway. Envoy sets
// X-Envoy-External-Address from the TCP peer (cannot be forged by the
// client), while c.IP() trusts X-Forwarded-For which Envoy appends to
// rather than overwrites — attackers can pre-seed XFF to control c.IP().
// Falls back to c.IP() for local dev or non-Envoy ingress.
func clientIP(c fiber.Ctx) string {
	if ip := c.Get("X-Envoy-External-Address"); ip != "" {
		return ip
	}
	return c.IP()
}

// rateLimitReached is a shared LimitReached handler that logs and returns 429.
func rateLimitReached(bucket string) fiber.Handler {
	return func(c fiber.Ctx) error {
		slog.Warn("rate limit hit",
			"bucket", bucket,
			"ip", clientIP(c),
			"path", c.Path(),
		)
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
			"error": "rate limit exceeded, retry after window expires",
		})
	}
}

// PerIPLimiter keys by the unspoofable client IP (X-Envoy-External-Address
// on Railway, c.IP() fallback for local dev). See clientIP() docs.
func PerIPLimiter(max int, bucket string) fiber.Handler {
	return limiter.New(limiter.Config{
		Max:          max,
		Expiration:   time.Minute,
		KeyGenerator: func(c fiber.Ctx) string { return "ip:" + clientIP(c) },
		LimitReached: rateLimitReached(bucket),
		Next:         skipIfDisabled,
	})
}

// PerIPFailureLimiter keys by client IP but counts only failed (4xx/5xx)
// responses. Used to throttle API-key brute-force without affecting
// legitimate auth'd traffic. Uses the unspoofable client IP (see clientIP()).
func PerIPFailureLimiter(max int, bucket string) fiber.Handler {
	return limiter.New(limiter.Config{
		Max:                    max,
		Expiration:             time.Minute,
		KeyGenerator:           func(c fiber.Ctx) string { return "ipfail:" + clientIP(c) },
		LimitReached:           rateLimitReached(bucket),
		Next:                   skipIfDisabled,
		SkipSuccessfulRequests: true,
	})
}

// PerAPIKeyLimiter keys by the authenticated merchant's API key ID.
// Must run AFTER APIKeyAuthMiddleware so merchant_api_key is in locals.
func PerAPIKeyLimiter(max int, bucket string) fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        max,
		Expiration: time.Minute,
		KeyGenerator: func(c fiber.Ctx) string {
			if m, ok := c.Locals("merchant_api_key").(*dbengine.Merchant); ok && m != nil {
				return "apikey:" + m.ID
			}
			// Fall back to IP — shouldn't happen if middleware ordering is correct,
			// but we don't want a missing key to open the floodgates.
			return "apikey-fallback:" + clientIP(c)
		},
		LimitReached: rateLimitReached(bucket),
		Next:         skipIfDisabled,
	})
}

// PerUserLimiter keys by the authenticated WorkOS user ID.
// Must run AFTER WorkosAuthMiddleware so workos_user is in locals.
func PerUserLimiter(max int, bucket string) fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        max,
		Expiration: time.Minute,
		KeyGenerator: func(c fiber.Ctx) string {
			if u, ok := c.Locals("workos_user").(auth.WorkOSUser); ok {
				return "user:" + u.ID
			}
			return "user-fallback:" + clientIP(c)
		},
		LimitReached: rateLimitReached(bucket),
		Next:         skipIfDisabled,
	})
}

// PerOrgLimiter keys by the org ID from the URL :id param. Used on
// /internal/organizations/:id/invitations to bound per-org email volume
// (each call sends a paid Resend email).
func PerOrgLimiter(max int, bucket string) fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        max,
		Expiration: time.Minute,
		KeyGenerator: func(c fiber.Ctx) string {
			orgID := c.Params("id")
			if orgID == "" {
				// Shouldn't happen for /organizations/:id/*, but fail closed.
				return "org-missing:" + clientIP(c)
			}
			return "org:" + orgID
		},
		LimitReached: rateLimitReached(bucket),
		Next:         skipIfDisabled,
	})
}
