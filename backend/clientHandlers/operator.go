package clientHandlers

import (
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
)

// agentDashboardResponse is the wire shape for GET /internal/client/agent.
// Combines: operator identity, balance (trial + paid + their sum), and
// every active API key (the dashboard renders one card per entry).
//
// `apiKeys` only includes keys that are auth-eligible right now (not revoked
// and not expired). Revoked keys live on the audit-trail endpoint
// (GET /internal/client/agent/keys) and are intentionally absent here so the
// dashboard's primary view never shows a credit-card visual for a key that
// can't actually spend.
//
// `stripePublishableKey` is echoed from the backend so the frontend doesn't
// have to maintain a drift-prone NEXT_PUBLIC_* counterpart of the Stripe
// account the backend is configured against.
type agentDashboardResponse struct {
	OperatorID           string       `json:"operatorId"`
	APIKeys              []apiKeyView `json:"apiKeys"`
	BalanceMicrounits    int64        `json:"balanceMicrounits"`
	TrialMicrounits      int64        `json:"trialMicrounits"`
	PaidMicrounits       int64        `json:"paidMicrounits"`
	StripePublishableKey string       `json:"stripePublishableKey"`
}

// GetOrCreateOperator handles GET /internal/client/agent. Lazy-creates the
// operator if missing (which also issues the trial credit per
// config.AgentCredits.TrialMicrounits) and returns everything the dashboard
// needs in a single round-trip.
func GetOrCreateOperator(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		op, ok := resolveOperator(c, pool)
		if !ok {
			return nil
		}

		trial, paid, err := dbengine.GetAgentCreditsBalances(c.Context(), pool, op.OrgID)
		if err != nil {
			slog.Error("get agent credits balances",
				"operator_id", op.Operator.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "failed to read balance"})
		}

		// 100 is well above any realistic per-org key count (active + revoked)
		// for the foreseeable future. We then filter to active-only for the
		// dashboard view; the full audit list lives on /agent/keys.
		keys, _, err := dbengine.ListAgentAPIKeysByOperator(c.Context(), pool, op.Operator.ID, 100, nil)
		if err != nil {
			slog.Error("list agent api keys",
				"operator_id", op.Operator.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "failed to read API keys"})
		}

		active := filterActiveKeys(keys)
		views := make([]apiKeyView, 0, len(active))
		for _, k := range active {
			views = append(views, toAPIKeyView(k))
		}

		return c.JSON(agentDashboardResponse{
			OperatorID:           op.Operator.ID,
			APIKeys:              views,
			BalanceMicrounits:    trial + paid,
			TrialMicrounits:      trial,
			PaidMicrounits:       paid,
			StripePublishableKey: config.Stripe.PublishableKey,
		})
	}
}

// filterActiveKeys returns only the keys that can still authenticate: not
// revoked, and not past their expires_at. Order is preserved from the input
// (which ListAgentAPIKeysByOperator delivers newest-first), so the dashboard
// renders the most-recently-created card on the left.
func filterActiveKeys(keys []dbengine.AgentAPIKeyPublic) []dbengine.AgentAPIKeyPublic {
	now := time.Now()
	active := make([]dbengine.AgentAPIKeyPublic, 0, len(keys))
	for _, k := range keys {
		if k.RevokedAt != nil {
			continue
		}
		if k.ExpiresAt != nil && !k.ExpiresAt.After(now) {
			continue
		}
		active = append(active, k)
	}
	return active
}
