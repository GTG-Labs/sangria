package auth

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jwt"
	"github.com/workos/workos-go/v4/pkg/usermanagement"

	dbengine "sangria/backend/dbEngine"
)

// jwksState holds the JWKS cache and URL for WorkOS JWT validation
type jwksState struct {
	cache *jwk.Cache
	url   string
}

// Global state for WorkOS JWT validation
var (
	state          jwksState
	expectedIssuer string
	stateMu        sync.RWMutex
	initOnce       sync.Once
	initErr        error
)

// InitJWKSCache initializes the global JWKS cache with proper security settings.
func InitJWKSCache(clientID string) error {
	initOnce.Do(func() {
		// Validate issuer first — fail fast if not configured.
		expectedIssuer = os.Getenv("WORKOS_TOKEN_ISSUER")
		if expectedIssuer == "" {
			initErr = fmt.Errorf("WORKOS_TOKEN_ISSUER environment variable is required")
			return
		}

		// Get JWKS URL for this client and store it for reuse
		parsedURL, err := usermanagement.GetJWKSURL(clientID)
		if err != nil {
			initErr = fmt.Errorf("failed to get JWKS URL: %w", err)
			return
		}

		// Create HTTP client with timeout to avoid indefinite hangs
		httpClient := &http.Client{
			Timeout: 10 * time.Second,
		}

		// Initialize JWKS cache with security restrictions
		cache := jwk.NewCache(context.Background())
		url := parsedURL.String()

		// Register the JWKS URL with the cache, using custom HTTP client and fetch whitelist
		err = cache.Register(url,
			jwk.WithHTTPClient(httpClient),
			jwk.WithFetchWhitelist(jwk.WhitelistFunc(func(u string) bool {
				return u == url
			})))
		if err != nil {
			initErr = fmt.Errorf("failed to register JWKS URL: %w", err)
			return
		}

		// Fetch and validate the JWKS immediately so we fail fast at startup
		// if the endpoint is unreachable or returns invalid keys.
		if _, err := cache.Refresh(context.Background(), url); err != nil {
			initErr = fmt.Errorf("failed to fetch JWKS on startup: %w", err)
			return
		}

		stateMu.Lock()
		state = jwksState{cache: cache, url: url}
		stateMu.Unlock()
	})
	return initErr
}

// VerifyWorkOSToken validates a WorkOS JWT token and extracts the user ID.
func VerifyWorkOSToken(ctx context.Context, tokenStr string) (string, error) {
	stateMu.RLock()
	cache := state.cache
	url := state.url
	stateMu.RUnlock()

	if cache == nil || url == "" {
		return "", fmt.Errorf("jwks cache not initialized — call InitJWKSCache first")
	}

	// Get key set from cache (this will automatically fetch/refresh as needed)
	keySet, err := cache.Get(ctx, url)
	if err != nil {
		return "", fmt.Errorf("failed to get JWKS from cache: %w", err)
	}

	// Step 1: Parse and verify signature only (no claim validation yet).
	token, err := jwt.ParseString(tokenStr, jwt.WithKeySet(keySet), jwt.WithValidate(false))
	if err != nil {
		return "", fmt.Errorf("failed to parse/verify token signature: %w", err)
	}

	// Step 2: Validate claims separately for clearer error messages.
	// WithAcceptableSkew: WorkOS may issue tokens with an `iat` a few seconds
	// ahead of this server's clock, causing "iat not satisfied" rejections.
	if err := jwt.Validate(token,
		jwt.WithAcceptableSkew(5*time.Second),
		jwt.WithIssuer(expectedIssuer),
	); err != nil {
		if errors.Is(err, jwt.ErrTokenExpired()) {
			return "", fmt.Errorf("token expired, please refresh your session")
		}
		// Debug: log actual issuer vs expected for troubleshooting
		if actualIssuer, ok := token.Get("iss"); ok {
			log.Printf("JWT issuer mismatch - expected: %s, actual: %s", expectedIssuer, actualIssuer)
		}
		return "", fmt.Errorf("token claim validation failed: %w", err)
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

// CreateUser handles POST /users endpoint
func CreateUser(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user := c.Locals("workos_user").(WorkOSUser)

		if user.ID == "" {
			log.Printf("CreateUser received session without WorkOS ID")
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
	}
}