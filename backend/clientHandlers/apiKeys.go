package clientHandlers

import (
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/auth"
	dbengine "sangria/backend/dbEngine"
	"sangria/backend/utils"
)

// createAgentAPIKeyRequest is the request body for POST /internal/client/agent/keys.
// All four cap fields are required (the schema's chk_agent_api_keys_*_positive
// constraints reject zero/negative); the dashboard's "no limit" toggle maps
// `null` to math.MaxInt64 at the wire boundary just like settings.go does.
type createAgentAPIKeyRequest struct {
	Name                          string     `json:"name"`
	MaxPerCallMicrounits          *int64     `json:"maxPerCallMicrounits"`
	DailyCapMicrounits            *int64     `json:"dailyCapMicrounits"`
	MonthlyCapMicrounits          *int64     `json:"monthlyCapMicrounits"`
	RequireConfirmAboveMicrounits *int64     `json:"requireConfirmAboveMicrounits"`
	ExpiresAt                     *time.Time `json:"expiresAt"`
}

// createAgentAPIKeyResponse is the one-time secret-reveal payload returned by
// the create endpoint. Includes the full API key string in the `apiKey`
// field — this is the ONLY response in the system that exposes it. Every
// subsequent read (ListAPIKeys, the dashboard's GET /agent) exposes only the
// 8-char keyId. Mirrors the merchant-key create response in
// adminHandlers/merchants.go.
type createAgentAPIKeyResponse struct {
	ID        string    `json:"id"`
	KeyID     string    `json:"keyId"`
	Name      string    `json:"name"`
	AgentName string    `json:"agentName"`
	APIKey    string    `json:"apiKey"`
	CreatedAt time.Time `json:"createdAt"`
}

// resolveCap turns a pointer-or-nil cap value from the request into the int64
// the dbEngine expects. nil means "no limit" → unlimitedSentinel. Returns an
// error for zero/negative values so the schema CHECK never sees a malformed
// row.
func resolveCap(fieldName string, v *int64, allowZero bool) (int64, error) {
	if v == nil {
		return unlimitedSentinel, nil
	}
	if *v < 0 {
		return 0, errors.New(fieldName + " must be non-negative")
	}
	if !allowZero && *v == 0 {
		return 0, errors.New(fieldName + " must be positive")
	}
	return *v, nil
}

// CreateAPIKey handles POST /internal/client/agent/keys. Mints a new
// `sg_agents_…` key for the operator, stores its bcrypt hash, and returns
// the full secret exactly once. The full secret is held only in a local
// variable and never echoed in errors or logs (see root CLAUDE.md § Security).
func CreateAPIKey(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		op, ok := resolveOperator(c, pool)
		if !ok {
			return nil
		}

		var req createAgentAPIKeyRequest
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).
				JSON(fiber.Map{"error": "invalid request body"})
		}

		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" {
			return c.Status(fiber.StatusBadRequest).
				JSON(fiber.Map{"error": "name is required"})
		}
		if len(req.Name) > 255 {
			return c.Status(fiber.StatusBadRequest).
				JSON(fiber.Map{"error": "name must be 255 characters or less"})
		}

		maxPerCall, err := resolveCap("maxPerCallMicrounits", req.MaxPerCallMicrounits, false)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		dailyCap, err := resolveCap("dailyCapMicrounits", req.DailyCapMicrounits, false)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		monthlyCap, err := resolveCap("monthlyCapMicrounits", req.MonthlyCapMicrounits, false)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		// require_confirm is the only cap that legitimately allows 0 — 0 means
		// "no confirmation step ever required, agent may spend without prompt".
		requireConfirm, err := resolveCap("requireConfirmAboveMicrounits", req.RequireConfirmAboveMicrounits, true)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		// 0 means "unlimited" only for the three caps; for require_confirm, a
		// raw nil should map to "never required" (0), not to MaxInt64.
		if req.RequireConfirmAboveMicrounits == nil {
			requireConfirm = 0
		}

		// fullKey is the only piece of secret material in this handler. It is
		// passed to HashAPIKey, written to the response once, and never assigned
		// to any other named slot. Matches the parseAPIKey reference pattern.
		fullKey, keyID, err := auth.GenerateAPIKey(auth.KeyTypeAgent)
		if err != nil {
			slog.Error("generate agent api key",
				"operator_id", op.Operator.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "failed to mint key"})
		}
		keyHash, err := auth.HashAPIKey(fullKey)
		if err != nil {
			slog.Error("hash agent api key",
				"operator_id", op.Operator.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "failed to hash key"})
		}

		agentName := utils.GenerateAgentName()

		created, err := dbengine.CreateAgentAPIKey(c.Context(), pool, dbengine.CreateAgentAPIKeyParams{
			AgentOperatorID:               op.Operator.ID,
			KeyHash:                       keyHash,
			KeyID:                         keyID,
			Name:                          req.Name,
			AgentName:                     agentName,
			MaxPerCallMicrounits:          maxPerCall,
			DailyCapMicrounits:            dailyCap,
			MonthlyCapMicrounits:          monthlyCap,
			RequireConfirmAboveMicrounits: requireConfirm,
			ExpiresAt:                     req.ExpiresAt,
		})
		if err != nil {
			slog.Error("insert agent api key",
				"operator_id", op.Operator.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "failed to create key"})
		}

		return c.Status(fiber.StatusCreated).JSON(createAgentAPIKeyResponse{
			ID:        created.ID,
			KeyID:     created.KeyID,
			Name:      created.Name,
			AgentName: created.AgentName,
			APIKey:    fullKey,
			CreatedAt: created.CreatedAt,
		})
	}
}

// ListAPIKeys handles GET /internal/client/agent/keys. Returns every key for
// the operator (including revoked ones — the dashboard wants the audit
// trail), public projection only.
func ListAPIKeys(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		op, ok := resolveOperator(c, pool)
		if !ok {
			return nil
		}

		// Dashboard surfaces all keys (active + revoked) for the audit trail;
		// 100 is well above any realistic per-org count.
		keys, _, err := dbengine.ListAgentAPIKeysByOperator(c.Context(), pool, op.Operator.ID, 100, nil)
		if err != nil {
			slog.Error("list agent api keys",
				"operator_id", op.Operator.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "failed to list keys"})
		}

		views := make([]apiKeyView, 0, len(keys))
		for _, k := range keys {
			views = append(views, toAPIKeyView(k))
		}
		return c.JSON(views)
	}
}

// updateAPIKeySettingsRequest is the PATCH body for the per-card settings
// modal. Same null=unlimited convention as the create endpoint: a `null`
// for any cap means "no limit" and maps to math.MaxInt64 in the DB, since
// the schema's chk_agent_api_keys_*_positive constraints reject zeros and
// negatives.
type updateAPIKeySettingsRequest struct {
	MaxPerCallMicrounits          *int64 `json:"maxPerCallMicrounits"`
	DailyCapMicrounits            *int64 `json:"dailyCapMicrounits"`
	MonthlyCapMicrounits          *int64 `json:"monthlyCapMicrounits"`
	RequireConfirmAboveMicrounits *int64 `json:"requireConfirmAboveMicrounits"`
}

// UpdateAPIKeySettings handles PATCH /internal/client/agent/keys/:id. Updates
// the per-card spend caps for a single key. The WHERE clause inside
// UpdateAgentAPIKeyCaps pins the update to (key_id, agent_operator_id) so
// the caller can't tamper with the path parameter to reach another org's
// keys; 0 rows affected collapses {not found, wrong operator, revoked}
// into a single 404, intentionally — distinguishing them would leak
// existence info across orgs.
func UpdateAPIKeySettings(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		op, ok := resolveOperator(c, pool)
		if !ok {
			return nil
		}

		keyID := c.Params("id")
		if strings.TrimSpace(keyID) == "" {
			return c.Status(fiber.StatusBadRequest).
				JSON(fiber.Map{"error": "key ID required"})
		}

		var req updateAPIKeySettingsRequest
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).
				JSON(fiber.Map{"error": "invalid request body"})
		}

		maxPerCall, err := resolveCap("maxPerCallMicrounits", req.MaxPerCallMicrounits, false)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		dailyCap, err := resolveCap("dailyCapMicrounits", req.DailyCapMicrounits, false)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		monthlyCap, err := resolveCap("monthlyCapMicrounits", req.MonthlyCapMicrounits, false)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		requireConfirm, err := resolveCap("requireConfirmAboveMicrounits", req.RequireConfirmAboveMicrounits, true)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		// 0 means "never require confirm"; only the three hard caps map nil
		// to unlimited.
		if req.RequireConfirmAboveMicrounits == nil {
			requireConfirm = 0
		}

		rowsAffected, err := dbengine.UpdateAgentAPIKeyCaps(
			c.Context(), pool, keyID, op.Operator.ID,
			dbengine.UpdateAgentAPIKeyCapsParams{
				MaxPerCallMicrounits:          maxPerCall,
				DailyCapMicrounits:            dailyCap,
				MonthlyCapMicrounits:          monthlyCap,
				RequireConfirmAboveMicrounits: requireConfirm,
			},
		)
		if err != nil {
			slog.Error("update agent api key caps",
				"key_id", keyID, "operator_id", op.Operator.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "failed to save settings"})
		}
		if rowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).
				JSON(fiber.Map{"error": "key not found"})
		}
		return c.Status(fiber.StatusNoContent).Send(nil)
	}
}

// RevokeAPIKey handles DELETE /internal/client/agent/keys/:id. The dbEngine
// RevokeAgentAPIKey enforces the org-admin permission check atomically in
// SQL — a row affected of 0 collapses three distinct cases (no such key,
// already revoked, requester is not an admin of the owning org) into a
// single 404. That collapse is intentional: distinguishing them would leak
// existence + role information across orgs.
func RevokeAPIKey(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		user, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "internal server error"})
		}

		keyID := c.Params("id")
		if strings.TrimSpace(keyID) == "" {
			return c.Status(fiber.StatusBadRequest).
				JSON(fiber.Map{"error": "key ID required"})
		}

		rowsAffected, err := dbengine.RevokeAgentAPIKey(c.Context(), pool, keyID, user.ID)
		if err != nil {
			slog.Error("revoke agent api key",
				"key_id", keyID, "user_id", user.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "failed to revoke key"})
		}
		if rowsAffected == 0 {
			return c.Status(fiber.StatusNotFound).
				JSON(fiber.Map{"error": "key not found or not revokable"})
		}
		return c.Status(fiber.StatusNoContent).Send(nil)
	}
}
