package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	dbengine "sangria/backend/dbEngine"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// ErrAPIKeyNotFound is returned when an API key does not exist or is not owned by the user.
var ErrAPIKeyNotFound = errors.New("API key not found or not owned by user")

// ErrInvalidAPIKey is returned when AuthenticateAPIKey cannot match the
// provided key to any active principal (no key_id match, or key_id matched
// but the hash comparison failed). Callers should use errors.Is to detect.
var ErrInvalidAPIKey = errors.New("invalid API key")

// AuthResult is the type-discriminated outcome of AuthenticateAPIKey. KeyType
// indicates which branch authenticated; the corresponding pointer fields are
// populated and the others are nil. OrganizationID is always set so neutral
// callers (middleware, audit logging) don't need to switch on KeyType.
type AuthResult struct {
	KeyType        KeyType
	OrganizationID string
	Merchant       *dbengine.Merchant      // set when KeyType == KeyTypeMerchant
	AgentAPIKey    *dbengine.AgentAPIKey   // set when KeyType == KeyTypeAgent
	AgentOperator  *dbengine.AgentOperator // set when KeyType == KeyTypeAgent
}

// precomputed bcrypt dummy hash
var dummyHash []byte

func init() {
	// The plaintext we hash doesn't matter — this hash is only ever compared
	// against an attacker-supplied key that won't match. The goal is purely
	// to force bcrypt to run so response time is constant on a no-match.
	h, err := bcrypt.GenerateFromPassword([]byte("dummy"), bcrypt.DefaultCost)
	if err != nil {
		panic(fmt.Sprintf("failed to generate dummy bcrypt hash: %v", err))
	}
	dummyHash = h
}

// CreateAPIKey creates a new merchant API key for an organization with the specified status.
func CreateAPIKey(ctx context.Context, pool *pgxpool.Pool, organizationID, name string, status dbengine.APIKeyStatus) (*dbengine.Merchant, string, error) {
	fullKey, keyID, err := GenerateAPIKey(KeyTypeMerchant)
	if err != nil {
		return nil, "", fmt.Errorf("failed to generate API key: %w", err)
	}

	// Hash the key for storage
	apiKeyHash, err := HashAPIKey(fullKey)
	if err != nil {
		return nil, "", fmt.Errorf("failed to hash API key: %w", err)
	}

	merchant, err := dbengine.CreateAPIKey(ctx, pool, organizationID, apiKeyHash, keyID, name, status, 10)
	if err != nil {
		return nil, "", err
	}

	return &merchant, fullKey, nil
}

// GetAPIKeysByOrganizationID retrieves all API keys for an organization without exposing hashed keys.
func GetAPIKeysByOrganizationID(ctx context.Context, pool *pgxpool.Pool, organizationID string) ([]dbengine.MerchantPublic, error) {
	return dbengine.ListAPIKeysByOrganization(ctx, pool, organizationID)
}

// AuthenticateAPIKey validates an API key and returns an AuthResult describing
// the authenticated principal. Uses indexed lookup by key_id for O(1) (modulo
// rare prefix collisions which iterate up to a handful of candidates).
//
// Returns AuthResult{} + ErrInvalidAPIKey when no active key matches the
// provided value. Returns AuthResult{} + ErrInvalidAPIKeyFormat when the key
// is malformed. Returns AuthResult{} + wrapped DB error on lookup failure.
func AuthenticateAPIKey(ctx context.Context, pool *pgxpool.Pool, providedKey string) (AuthResult, error) {
	keyType, _, keyID, err := parseAPIKey(providedKey)
	if err != nil {
		// parseAPIKey already wraps ErrInvalidAPIKeyFormat with a descriptive message.
		return AuthResult{}, err
	}

	switch keyType {
	case KeyTypeMerchant:
		return authenticateMerchantKey(ctx, pool, providedKey, keyID)
	case KeyTypeAgent:
		return authenticateAgentKey(ctx, pool, providedKey, keyID)
	default:
		// parseAPIKey guarantees one of the two known types on a nil-error path.
		return AuthResult{}, fmt.Errorf("unexpected key type from parser: %q", keyType)
	}
}

// authenticateMerchantKey looks up active merchant keys by prefix, verifies
// the provided key against each candidate's bcrypt hash, and on match returns
// the populated AuthResult and bumps last_used_at.
func authenticateMerchantKey(ctx context.Context, pool *pgxpool.Pool, providedKey, keyID string) (AuthResult, error) {
	candidates, err := dbengine.GetActiveMerchantsByKeyID(ctx, pool, keyID)
	if err != nil {
		return AuthResult{}, err
	}

	for _, merchant := range candidates {
		if VerifyAPIKey(providedKey, merchant.APIKey) {
			if err := dbengine.UpdateMerchantLastUsedAt(ctx, pool, merchant.ID); err != nil {
				slog.Warn("failed to update merchant last_used_at", "merchant_id", merchant.ID, "error", err)
			}
			return AuthResult{
				KeyType:        KeyTypeMerchant,
				OrganizationID: merchant.OrganizationID,
				Merchant:       &merchant,
			}, nil
		}
	}

	// No candidates matched — run dummy bcrypt to keep response time constant.
	if len(candidates) == 0 {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(providedKey))
	}
	return AuthResult{}, ErrInvalidAPIKey
}

// authenticateAgentKey looks up active (not revoked, not expired) agent keys
// by prefix, verifies the provided key against each candidate, and on match
// loads the owning operator (for OrganizationID + downstream handler use) and
// bumps last_used_at. Mirrors authenticateMerchantKey shape exactly.
func authenticateAgentKey(ctx context.Context, pool *pgxpool.Pool, providedKey, keyID string) (AuthResult, error) {
	candidates, err := dbengine.GetActiveAgentAPIKeysByKeyID(ctx, pool, keyID)
	if err != nil {
		return AuthResult{}, err
	}

	for _, key := range candidates {
		if VerifyAPIKey(providedKey, key.KeyHash) {
			// Load operator for OrganizationID + reuse-on-request-by-handlers.
			operator, err := dbengine.GetAgentOperatorByID(ctx, pool, key.AgentOperatorID)
			if err != nil {
				// FK should prevent this; surface loudly if it ever happens.
				return AuthResult{}, fmt.Errorf("agent key matched but operator lookup failed: %w", err)
			}
			if err := dbengine.TouchAgentAPIKeyLastUsed(ctx, pool, key.ID); err != nil {
				slog.Warn("failed to touch agent api key last_used_at", "id", key.ID, "error", err)
			}
			return AuthResult{
				KeyType:        KeyTypeAgent,
				OrganizationID: operator.OrganizationID,
				AgentAPIKey:    &key,
				AgentOperator:  &operator,
			}, nil
		}
	}

	// No candidates matched — run dummy bcrypt to keep response time constant.
	if len(candidates) == 0 {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(providedKey))
	}
	return AuthResult{}, ErrInvalidAPIKey
}

// RevokeAPIKey atomically deactivates an API key, but only if the requesting
// user is an admin of the organization that owns it.
func RevokeAPIKey(ctx context.Context, pool *pgxpool.Pool, merchantID, adminUserID string) error {
	rowsAffected, err := dbengine.RevokeMerchantAPIKey(ctx, pool, merchantID, adminUserID)
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrAPIKeyNotFound
	}
	return nil
}
