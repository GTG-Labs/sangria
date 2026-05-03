package auth

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

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

// CachedUserInfo holds user information with cache metadata
type CachedUserInfo struct {
	User      WorkOSUser
	CachedAt  time.Time
	ExpiresAt time.Time
}

// userInfoCache provides thread-safe caching of WorkOS user information
// for banking application availability requirements
var (
	userInfoCache = make(map[string]CachedUserInfo)
	cacheMutex    sync.RWMutex
	cacheTimeout  = 30 * time.Minute // Cache for 30 minutes
)

// getCachedUserInfo attempts to retrieve user info from cache
func getCachedUserInfo(userID string) (WorkOSUser, bool) {
	cacheMutex.RLock()
	defer cacheMutex.RUnlock()

	cached, exists := userInfoCache[userID]
	if !exists {
		return WorkOSUser{}, false
	}

	// Check if cache entry has expired
	if time.Now().After(cached.ExpiresAt) {
		return WorkOSUser{}, false
	}

	return cached.User, true
}

// setCachedUserInfo stores user info in cache with expiration
func setCachedUserInfo(userID string, user WorkOSUser) {
	cacheMutex.Lock()
	defer cacheMutex.Unlock()

	now := time.Now()
	userInfoCache[userID] = CachedUserInfo{
		User:      user,
		CachedAt:  now,
		ExpiresAt: now.Add(cacheTimeout),
	}
}

// getUserInfoWithFallback attempts WorkOS API first, falls back to cache for availability
func getUserInfoWithFallback(userID string) (WorkOSUser, error) {
	// Try WorkOS API first
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	user, err := usermanagement.GetUser(ctx, usermanagement.GetUserOpts{
		User: userID,
	})

	if err == nil {
		// Success - cache the result and return
		workosUser := WorkOSUser{
			ID:        user.ID,
			Email:     user.Email,
			FirstName: user.FirstName,
			LastName:  user.LastName,
		}
		setCachedUserInfo(userID, workosUser)
		return workosUser, nil
	}

	// WorkOS API failed - log and try cache
	slog.Warn("WorkOS API unavailable, attempting cache fallback", "user_id", userID, "error", err)

	// Check cache for fallback
	if cachedUser, found := getCachedUserInfo(userID); found {
		slog.Info("Using cached user info for availability", "user_id", userID)
		return cachedUser, nil
	}

	// Both WorkOS and cache failed
	slog.Error("Both WorkOS API and cache failed for user", "user_id", userID, "workos_error", err)
	return WorkOSUser{}, err
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

	// Get user info with availability fallback for banking resilience
	user, err := getUserInfoWithFallback(userID)
	if err != nil {
		// Only fail if both WorkOS API and cache are unavailable
		return c.Status(401).JSON(fiber.Map{"error": "User session not found"})
	}

	// Store validated user info in context
	c.Locals("workos_user", user)

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
		c.Locals("merchant_organization_id", merchantKey.OrganizationID)

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