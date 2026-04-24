package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
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

		owner := user.Email
		if user.FirstName != "" && user.LastName != "" {
			owner = fmt.Sprintf("%s %s", user.FirstName, user.LastName)
		}

		// Use a single transaction for both user upsert and personal org creation
		tx, err := pool.Begin(c.Context())
		if err != nil {
			slog.Error("begin transaction", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to begin transaction"})
		}
		defer tx.Rollback(c.Context())

		// Step 1: Create/update user within transaction
		u, err := dbengine.UpsertUserTx(c.Context(), tx, owner, user.ID)
		if err != nil {
			slog.Error("upsert user", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create user"})
		}

		// Step 2: Ensure user has a personal organization within the same transaction
		err = dbengine.EnsurePersonalOrganizationTx(c.Context(), tx, user.ID, owner)
		if err != nil {
			slog.Error("ensure personal organization", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to setup personal organization"})
		}

		// Commit the transaction
		if err := tx.Commit(c.Context()); err != nil {
			slog.Error("commit transaction", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to commit transaction"})
		}

		// Step 3: Process any accepted invitations for this user's email
		err = dbengine.ProcessAcceptedInvitations(c.Context(), pool, user.ID, user.Email)
		if err != nil {
			slog.Error("process accepted invitations", "user_id", user.ID, "email", user.Email, "error", err)
			// Don't fail the user creation, just log the error
		}

		return c.Status(201).JSON(u)
	}
}

// GetCurrentUser handles GET /internal/me endpoint
func GetCurrentUser(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		// Process any accepted invitations before fetching orgs, so newly
		// accepted orgs appear immediately in the response.
		if err := dbengine.ProcessAcceptedInvitations(c.Context(), pool, user.ID, user.Email); err != nil {
			slog.Error("process accepted invitations", "user_id", user.ID, "error", err)
			// Non-fatal — continue loading the user's data
		}

		// Get user's organizations with details in a single query
		userOrgs, err := dbengine.GetUserOrganizationsWithDetails(c.Context(), pool, user.ID)
		if err != nil {
			slog.Error("get user organizations", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch user organizations"})
		}

		// Check if user is a Sangria admin
		isAdmin, err := dbengine.IsAdmin(c.Context(), pool, user.ID)
		if err != nil {
			slog.Error("check admin status", "error", err)
			// Don't fail the request, just assume not admin
			isAdmin = false
		}

		// Format organizations for frontend
		organizations := make([]fiber.Map, 0, len(userOrgs))
		for _, org := range userOrgs {
			organizations = append(organizations, fiber.Map{
				"id":         org.ID,
				"name":       org.Name,
				"isPersonal": org.IsPersonal,
				"isAdmin":    org.IsAdmin,
			})
		}

		return c.JSON(fiber.Map{
			"id":            user.ID,
			"firstName":     user.FirstName,
			"lastName":      user.LastName,
			"email":         user.Email,
			"isAdmin":       isAdmin,
			"organizations": organizations,
		})
	}
}

// CreateOrganization handles POST /internal/organizations endpoint
func CreateOrganization(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		if user.ID == "" {
			slog.Error("CreateOrganization: session missing WorkOS ID")
			return c.Status(500).JSON(fiber.Map{"error": "Invalid user session"})
		}

		// Parse request body
		var req struct {
			Name string `json:"name"`
		}

		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		// Validate organization name
		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" {
			return c.Status(400).JSON(fiber.Map{"error": "organization name is required"})
		}

		if len(req.Name) > 255 {
			return c.Status(400).JSON(fiber.Map{"error": "organization name must be 255 characters or less"})
		}

		// Create organization with user as admin
		orgID, err := dbengine.CreateOrganization(c.Context(), pool, user.ID, req.Name)
		if err != nil {
			slog.Error("create organization", "user_id", user.ID, "name", req.Name, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create organization"})
		}

		return c.JSON(fiber.Map{
			"id":         orgID,
			"name":       req.Name,
			"isPersonal": false,
			"isAdmin":    true,
		})
	}
}

// GetOrganizationMembers handles GET /internal/organizations/:id/members endpoint
func GetOrganizationMembers(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		orgID := c.Params("id")
		if orgID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "organization ID is required"})
		}

		// Verify the requesting user is a member of this organization
		isMember, err := dbengine.IsOrganizationMember(c.Context(), pool, user.ID, orgID)
		if err != nil {
			slog.Error("check org membership", "user_id", user.ID, "org_id", orgID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to verify permissions"})
		}
		if !isMember {
			return c.Status(403).JSON(fiber.Map{"error": "access denied - not a member of this organization"})
		}

		// All organization members can view other members
		// (Previously only admins could view, but this has been relaxed for better team transparency)

		// Get organization members
		orgMembers, err := dbengine.ListOrganizationMembers(c.Context(), pool, orgID)
		if err != nil {
			slog.Error("list organization members", "org_id", orgID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch organization members"})
		}

		return c.JSON(fiber.Map{
			"members": orgMembers,
		})
	}
}

// RemoveOrganizationMember handles DELETE /internal/organizations/:id/members/:userId endpoint
// Only admins can remove members from the organization
func RemoveOrganizationMember(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		orgID := c.Params("id")
		memberUserID := c.Params("userId")
		if orgID == "" || memberUserID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "organization ID and user ID are required"})
		}

		// Prevent removing yourself (to avoid locking out all admins)
		if memberUserID == user.ID {
			return c.Status(400).JSON(fiber.Map{"error": "cannot remove yourself from the organization"})
		}

		// Atomically remove the member, but only if the requesting user is an admin
		rowsAffected, err := dbengine.RemoveOrganizationMemberAsAdmin(c.Context(), pool, memberUserID, orgID, user.ID)
		if err != nil {
			slog.Error("remove user from organization", "user_id", memberUserID, "org_id", orgID, "admin_user", user.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to remove member from organization"})
		}
		if rowsAffected == 0 {
			return c.Status(404).JSON(fiber.Map{"error": "member not found or admin access required"})
		}

		slog.Info("Member removed from organization",
			"removed_user_id", memberUserID,
			"org_id", orgID,
			"admin_user", user.ID,
		)

		return c.JSON(fiber.Map{
			"message": "Member removed from organization successfully",
		})
	}
}