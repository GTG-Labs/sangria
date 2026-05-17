package clientHandlers

import (
	"log/slog"
	"math"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/auth"
	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
)

// operatorContext bundles the auth + org + operator triple every /internal/client/*
// handler needs. Built once per request by resolveOperator.
type operatorContext struct {
	User     auth.WorkOSUser
	OrgID    string
	Operator dbengine.AgentOperator
}

// resolveOperator runs the "auth → org → operator" chain shared by every
// dashboard endpoint. On any failure it writes the appropriate HTTP response
// to c directly and returns (nil, false); callers `return nil` on the false
// branch so the response stands. On success returns the populated context.
//
// CreateAgentOperator is idempotent on organization_id — a second call for an
// org that already has an operator returns the existing row unchanged and does
// not re-grant the trial credit. That property lets every endpoint use this
// helper without worrying about double-grants.
func resolveOperator(c fiber.Ctx, pool *pgxpool.Pool) (*operatorContext, bool) {
	user, ok := c.Locals("workos_user").(auth.WorkOSUser)
	if !ok {
		_ = c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
		return nil, false
	}

	orgResult := auth.ResolveOrganizationContext(c.Context(), c, pool, user)
	if orgResult.Error != "" {
		_ = c.Status(orgResult.HTTPStatus).JSON(fiber.Map{"error": orgResult.Error})
		return nil, false
	}

	operator, err := dbengine.CreateAgentOperator(
		c.Context(), pool, orgResult.OrganizationID,
		config.AgentCredits.TrialMicrounits,
	)
	if err != nil {
		slog.Error("ensure agent operator",
			"org_id", orgResult.OrganizationID, "user_id", user.ID, "error", err)
		_ = c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to load operator"})
		return nil, false
	}

	return &operatorContext{User: user, OrgID: orgResult.OrganizationID, Operator: operator}, true
}

// apiKeyView is the dashboard-safe public projection of an agent API key.
// Strips the bcrypt hash; keyId is the 8-char lookup prefix only. The full
// secret only ever appears in the create-key response (once).
type apiKeyView struct {
	ID                            string     `json:"id"`
	KeyID                         string     `json:"keyId"`
	Name                          string     `json:"name"`
	AgentName                     string     `json:"agentName"`
	MaxPerCallMicrounits          int64      `json:"maxPerCallMicrounits"`
	DailyCapMicrounits            int64      `json:"dailyCapMicrounits"`
	MonthlyCapMicrounits          int64      `json:"monthlyCapMicrounits"`
	RequireConfirmAboveMicrounits int64      `json:"requireConfirmAboveMicrounits"`
	ExpiresAt                     *time.Time `json:"expiresAt"`
	LastUsedAt                    *time.Time `json:"lastUsedAt"`
	RevokedAt                     *time.Time `json:"revokedAt"`
	CreatedAt                     time.Time  `json:"createdAt"`
}

func toAPIKeyView(k dbengine.AgentAPIKeyPublic) apiKeyView {
	return apiKeyView{
		ID:                            k.ID,
		KeyID:                         k.KeyID,
		Name:                          k.Name,
		AgentName:                     k.AgentName,
		MaxPerCallMicrounits:          k.MaxPerCallMicrounits,
		DailyCapMicrounits:            k.DailyCapMicrounits,
		MonthlyCapMicrounits:          k.MonthlyCapMicrounits,
		RequireConfirmAboveMicrounits: k.RequireConfirmAboveMicrounits,
		ExpiresAt:                     k.ExpiresAt,
		LastUsedAt:                    k.LastUsedAt,
		RevokedAt:                     k.RevokedAt,
		CreatedAt:                     k.CreatedAt,
	}
}

// pickNewestActiveKey returns the newest non-revoked, non-expired key from
// a list ordered newest-first (the order ListAgentAPIKeysByOperator returns).
// Used by /agent and /settings to identify the "current" key for display +
// caps editing. Returns nil if there is no usable key.
func pickNewestActiveKey(keys []dbengine.AgentAPIKeyPublic) *dbengine.AgentAPIKeyPublic {
	now := time.Now()
	for i := range keys {
		k := &keys[i]
		if k.RevokedAt != nil {
			continue
		}
		if k.ExpiresAt != nil && !k.ExpiresAt.After(now) {
			continue
		}
		return k
	}
	return nil
}

// unlimitedSentinel is the on-the-wire representation of "no limit" used by
// PATCH /internal/client/settings. The schema CHECKs require caps > 0, so we
// can't store 0 to mean unlimited; instead the handler translates a JSON
// `null` from the client to math.MaxInt64 in the DB, and translates
// math.MaxInt64 back to `null` on read. ($9.2 quintillion is functionally
// unbounded for our use case.)
const unlimitedSentinel = int64(math.MaxInt64)

// microunitsOrNil returns nil if v == unlimitedSentinel, else &v. Used to
// render caps back to the dashboard with "no limit" semantics.
func microunitsOrNil(v int64) *int64 {
	if v == unlimitedSentinel {
		return nil
	}
	return &v
}
