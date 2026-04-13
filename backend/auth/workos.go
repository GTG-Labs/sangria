package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
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
		// Log actual issuer vs expected to aid troubleshooting.
		if actualIssuer, ok := token.Get("iss"); ok {
			slog.Warn("JWT issuer mismatch", "expected", expectedIssuer, "actual", actualIssuer)
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
		user, ok := c.Locals("workos_user").(WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		if user.ID == "" {
			slog.Error("CreateUser: session missing WorkOS ID")
			return c.Status(500).JSON(fiber.Map{"error": "Invalid user session"})
		}

		owner := user.Email
		if user.FirstName != "" && user.LastName != "" {
			owner = fmt.Sprintf("%s %s", user.FirstName, user.LastName)
		}

		// Step 1: Create/update user
		u, err := dbengine.UpsertUser(c.Context(), pool, owner, user.ID)
		if err != nil {
			slog.Error("upsert user", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create user"})
		}

		// Step 2: Ensure user has a personal organization
		err = ensureUserPersonalOrganization(c.Context(), pool, user.ID, owner)
		if err != nil {
			slog.Error("ensure personal organization", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to setup personal organization"})
		}

		return c.Status(201).JSON(u)
	}
}

// ensureUserPersonalOrganization creates a personal organization for the user if they don't have one
// Each user gets their own personal organization where they are the admin
func ensureUserPersonalOrganization(ctx context.Context, pool *pgxpool.Pool, userWorkosID, userName string) error {
	// Start transaction to ensure atomicity
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Acquire a row lock on the user to serialize concurrent flows
	var lockCheck bool
	err = tx.QueryRow(ctx, `
		SELECT true FROM users WHERE workos_id = $1 FOR UPDATE`,
		userWorkosID,
	).Scan(&lockCheck)
	if err != nil {
		return fmt.Errorf("failed to acquire user lock: %w", err)
	}

	// Re-query user memberships inside the transaction to detect concurrent creations
	rows, err := tx.Query(ctx, `
		SELECT user_id, organization_id, is_admin, joined_at
		FROM organization_members
		WHERE user_id = $1
		ORDER BY joined_at ASC`,
		userWorkosID,
	)
	if err != nil {
		return fmt.Errorf("failed to get user organizations in transaction: %w", err)
	}
	defer rows.Close()

	var memberships []dbengine.OrganizationMember
	for rows.Next() {
		var m dbengine.OrganizationMember
		if err := rows.Scan(&m.UserID, &m.OrganizationID, &m.IsAdmin, &m.JoinedAt); err != nil {
			return fmt.Errorf("failed to scan membership: %w", err)
		}
		memberships = append(memberships, m)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("error iterating memberships: %w", err)
	}

	// If user already has organizations, skip creating personal org
	// (they might be returning users or have been invited to orgs)
	if len(memberships) > 0 {
		return tx.Commit(ctx)
	}

	// Create personal organization inside transaction
	var personalOrgID string
	personalOrgName := fmt.Sprintf("%s's Personal Organization", userName)

	err = tx.QueryRow(ctx, `
		INSERT INTO organizations (name, created_at)
		VALUES ($1, NOW())
		RETURNING id`,
		personalOrgName).Scan(&personalOrgID)
	if err != nil {
		return fmt.Errorf("failed to create personal organization: %w", err)
	}

	// Add user to their personal organization as admin using transaction
	err = dbengine.AddUserToOrganizationTx(ctx, tx, userWorkosID, personalOrgID, true)
	if err != nil {
		return fmt.Errorf("failed to add user to personal organization: %w", err)
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit personal organization transaction: %w", err)
	}

	return nil
}