package dbengine

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// agentApiKeyColumns is the full SELECT / RETURNING column list for agent_api_keys.
// Includes key_hash — used for auth-path queries where bcrypt verify needs it.
const agentApiKeyColumns = `id, agent_operator_id, key_hash, key_id, name, agent_name,
	max_per_call_microunits, daily_cap_microunits, monthly_cap_microunits,
	require_confirm_above_microunits, expires_at, last_used_at, revoked_at, created_at`

// agentApiKeyPublicColumns omits key_hash. Used by dashboard list queries that
// must never expose bcrypt hashes to clients.
const agentApiKeyPublicColumns = `id, agent_operator_id, key_id, name, agent_name,
	max_per_call_microunits, daily_cap_microunits, monthly_cap_microunits,
	require_confirm_above_microunits, expires_at, last_used_at, revoked_at, created_at`

// scanAgentAPIKey scans a row produced by SELECT agentApiKeyColumns.
func scanAgentAPIKey(row pgx.Row) (AgentAPIKey, error) {
	var k AgentAPIKey
	err := row.Scan(
		&k.ID, &k.AgentOperatorID, &k.KeyHash, &k.KeyID, &k.Name, &k.AgentName,
		&k.MaxPerCallMicrounits, &k.DailyCapMicrounits, &k.MonthlyCapMicrounits,
		&k.RequireConfirmAboveMicrounits, &k.ExpiresAt, &k.LastUsedAt, &k.RevokedAt, &k.CreatedAt,
	)
	return k, err
}

// scanAgentAPIKeyPublic scans a row produced by SELECT agentApiKeyPublicColumns.
func scanAgentAPIKeyPublic(row pgx.Row) (AgentAPIKeyPublic, error) {
	var k AgentAPIKeyPublic
	err := row.Scan(
		&k.ID, &k.AgentOperatorID, &k.KeyID, &k.Name, &k.AgentName,
		&k.MaxPerCallMicrounits, &k.DailyCapMicrounits, &k.MonthlyCapMicrounits,
		&k.RequireConfirmAboveMicrounits, &k.ExpiresAt, &k.LastUsedAt, &k.RevokedAt, &k.CreatedAt,
	)
	return k, err
}

// CreateAgentAPIKeyParams holds the inputs for CreateAgentAPIKey. Callers at
// the auth layer compose this: generate the raw key + hash + agent name, then
// pass everything down. dbEngine stays a leaf package (no crypto, no random
// helpers) — same layering pattern as the merchant-side CreateAPIKey.
type CreateAgentAPIKeyParams struct {
	AgentOperatorID               string
	KeyHash                       string
	KeyID                         string
	Name                          string // user-supplied label
	AgentName                     string // server-generated handle (utils.GenerateAgentName)
	MaxPerCallMicrounits          int64
	DailyCapMicrounits            int64
	MonthlyCapMicrounits          int64
	RequireConfirmAboveMicrounits int64
	ExpiresAt                     *time.Time
}

// CreateAgentAPIKey inserts a new agent API key. Caller supplies a pre-bcrypted
// KeyHash (auth.HashAPIKey) and a pre-generated AgentName (utils.GenerateAgentName);
// this function only validates + stores. DB uniqueness violations (e.g.
// duplicate active name within the operator) surface as-is so the caller can
// decide how to handle them.
func CreateAgentAPIKey(ctx context.Context, pool *pgxpool.Pool, params CreateAgentAPIKeyParams) (AgentAPIKey, error) {
	if err := validateCreateAgentAPIKeyParams(params); err != nil {
		return AgentAPIKey{}, err
	}

	row := pool.QueryRow(ctx,
		`INSERT INTO agent_api_keys (
			agent_operator_id, key_hash, key_id, name, agent_name,
			max_per_call_microunits, daily_cap_microunits, monthly_cap_microunits,
			require_confirm_above_microunits, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING `+agentApiKeyColumns,
		params.AgentOperatorID, params.KeyHash, params.KeyID, params.Name, params.AgentName,
		params.MaxPerCallMicrounits, params.DailyCapMicrounits, params.MonthlyCapMicrounits,
		params.RequireConfirmAboveMicrounits, params.ExpiresAt,
	)
	k, err := scanAgentAPIKey(row)
	if err != nil {
		return AgentAPIKey{}, fmt.Errorf("insert agent api key: %w", err)
	}
	return k, nil
}

// validateCreateAgentAPIKeyParams runs defensive input checks before hitting the
// DB. The schema CHECK constraints provide the final guarantee; this layer
// gives better error messages.
func validateCreateAgentAPIKeyParams(p CreateAgentAPIKeyParams) error {
	if strings.TrimSpace(p.AgentOperatorID) == "" {
		return fmt.Errorf("agent operator ID must not be empty")
	}
	if strings.TrimSpace(p.KeyHash) == "" {
		return fmt.Errorf("key hash must not be empty")
	}
	if len(p.KeyID) != 8 {
		return fmt.Errorf("key ID must be 8 characters, got %d", len(p.KeyID))
	}
	if strings.TrimSpace(p.Name) == "" {
		return fmt.Errorf("name must not be empty")
	}
	if strings.TrimSpace(p.AgentName) == "" {
		return fmt.Errorf("agent name must not be empty")
	}
	if p.MaxPerCallMicrounits <= 0 {
		return fmt.Errorf("max_per_call_microunits must be positive, got %d", p.MaxPerCallMicrounits)
	}
	if p.DailyCapMicrounits <= 0 {
		return fmt.Errorf("daily_cap_microunits must be positive, got %d", p.DailyCapMicrounits)
	}
	if p.MonthlyCapMicrounits <= 0 {
		return fmt.Errorf("monthly_cap_microunits must be positive, got %d", p.MonthlyCapMicrounits)
	}
	if p.RequireConfirmAboveMicrounits < 0 {
		return fmt.Errorf("require_confirm_above_microunits must be non-negative, got %d", p.RequireConfirmAboveMicrounits)
	}
	return nil
}

// GetActiveAgentAPIKeysByKeyID returns all agent API keys matching the given
// 8-char keyID prefix that are auth-eligible (not revoked, not expired).
// Returns a slice because key_id is non-unique — auth middleware iterates and
// bcrypt-compares each candidate (mirrors GetActiveMerchantsByKeyID). LIMIT 5
// guards against pathological collision storms; with 4 billion possible
// prefixes, real-world results are 1 row.
func GetActiveAgentAPIKeysByKeyID(ctx context.Context, pool *pgxpool.Pool, keyID string) ([]AgentAPIKey, error) {
	if strings.TrimSpace(keyID) == "" {
		return nil, fmt.Errorf("key ID must not be empty")
	}
	rows, err := pool.Query(ctx,
		`SELECT `+agentApiKeyColumns+`
		 FROM agent_api_keys
		 WHERE key_id = $1
		   AND revoked_at IS NULL
		   AND (expires_at IS NULL OR expires_at > NOW())
		 LIMIT 5`,
		keyID,
	)
	if err != nil {
		return nil, fmt.Errorf("query agent api keys: %w", err)
	}
	defer rows.Close()

	var keys []AgentAPIKey
	for rows.Next() {
		k, err := scanAgentAPIKey(rows)
		if err != nil {
			return nil, fmt.Errorf("scan agent api key: %w", err)
		}
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate agent api keys: %w", err)
	}
	return keys, nil
}

// TouchAgentAPIKeyLastUsed bumps last_used_at to NOW for the given key row.
// Called by auth middleware on every successful authentication. Fire-and-
// forget UPDATE; per-request write cost is acceptable for V1 (debounce later
// if it becomes a bottleneck).
func TouchAgentAPIKeyLastUsed(ctx context.Context, pool *pgxpool.Pool, id string) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("id must not be empty")
	}
	_, err := pool.Exec(ctx,
		`UPDATE agent_api_keys SET last_used_at = NOW() WHERE id = $1`,
		id,
	)
	if err != nil {
		return fmt.Errorf("touch agent api key last_used_at: %w", err)
	}
	return nil
}

// ListAgentAPIKeysByOperator returns all API keys for an operator (including
// revoked ones, for dashboard audit visibility) in newest-first order.
// Returns the Public shape — key_hash is never selected, let alone returned.
func ListAgentAPIKeysByOperator(ctx context.Context, pool *pgxpool.Pool, agentOperatorID string) ([]AgentAPIKeyPublic, error) {
	if strings.TrimSpace(agentOperatorID) == "" {
		return nil, fmt.Errorf("agent operator ID must not be empty")
	}
	rows, err := pool.Query(ctx,
		`SELECT `+agentApiKeyPublicColumns+`
		 FROM agent_api_keys
		 WHERE agent_operator_id = $1
		 ORDER BY created_at DESC`,
		agentOperatorID,
	)
	if err != nil {
		return nil, fmt.Errorf("query agent api keys: %w", err)
	}
	defer rows.Close()

	var keys []AgentAPIKeyPublic
	for rows.Next() {
		k, err := scanAgentAPIKeyPublic(rows)
		if err != nil {
			return nil, fmt.Errorf("scan agent api key: %w", err)
		}
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate agent api keys: %w", err)
	}
	return keys, nil
}

// RevokeAgentAPIKey marks an agent API key as revoked (sets revoked_at = NOW)
// in a single statement that also enforces the admin permission check, so the
// authorization decision and the mutation cannot be split by a race (root
// CLAUDE.md § Code "Atomic admin checks"). Returns the number of rows
// affected — 0 means either the key doesn't exist, was already revoked, or
// the user isn't an admin of the owning org. Mirrors RevokeMerchantAPIKey.
func RevokeAgentAPIKey(ctx context.Context, pool *pgxpool.Pool, id, adminUserID string) (int64, error) {
	if strings.TrimSpace(id) == "" {
		return 0, fmt.Errorf("id must not be empty")
	}
	if strings.TrimSpace(adminUserID) == "" {
		return 0, fmt.Errorf("admin user ID must not be empty")
	}
	result, err := pool.Exec(ctx,
		`UPDATE agent_api_keys SET revoked_at = NOW()
		 FROM agent_operators ao, organization_members om
		 WHERE agent_api_keys.id = $1
		   AND agent_api_keys.revoked_at IS NULL
		   AND agent_api_keys.agent_operator_id = ao.id
		   AND ao.organization_id = om.organization_id
		   AND om.user_id = $2 AND om.is_admin = true`,
		id, adminUserID,
	)
	if err != nil {
		return 0, fmt.Errorf("revoke agent api key: %w", err)
	}
	return result.RowsAffected(), nil
}

