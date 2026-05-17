package routes

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/agentHandlers"
	"sangria/backend/auth"
	"sangria/backend/buyHandlers"
	"sangria/backend/config"
	"sangria/backend/merchantHandlers"
	"sangria/backend/ratelimit"
)

func RegisterAPIKeyRoutes(app *fiber.App, pool *pgxpool.Pool) {
	// Pre-auth per-IP limiter (counts only failures) catches brute force;
	// post-auth per-API-key limiter throttles authed callers (merchant or agent).
	v1 := app.Group("/v1",
		ratelimit.PerIPFailureLimiter(config.RateLimit.AuthFailuresPerMin, "v1-auth-failure"),
		auth.APIKeyAuthMiddleware(pool),
		ratelimit.PerAPIKeyLimiter(config.RateLimit.V1PerMin, "v1-per-apikey"),
	)

	// Merchant routes — gated to reject agent keys so handlers expecting
	// merchant_api_key locals never see a wrong-typed principal.
	merchant := v1.Group("", auth.RequireMerchantKey)
	merchant.Post("/generate-payment", merchantHandlers.GeneratePayment(pool))
	merchant.Post("/verify-payment", merchantHandlers.VerifyPayment(pool))
	merchant.Post("/settle-payment", merchantHandlers.SettlePayment(pool))

	// Agent SDK routes — gated to reject merchant keys for the mirror reason.
	// Mounted at the root of /v1 (not /v1/agent) so paths match the agent
	// SDK skill: /v1/balance, /v1/buy, /v1/buy/{id}/confirm, etc.
	agent := v1.Group("", auth.RequireAgentKey)
	agent.Get("/balance", agentHandlers.GetAgentBalance(pool))

	// /v1/buy discovery + checkout flow. Full handler logic + state machine
	// in backend/buyHandlers/; see agent-sdk-planning/BUY_ENDPOINT_PLAN.md.
	agent.Post("/buy", buyHandlers.Buy(pool))
	agent.Post("/buy/:id/confirm", buyHandlers.Confirm(pool))
	agent.Post("/buy/:id/cancel", buyHandlers.Cancel(pool))
	agent.Get("/buy/:id", buyHandlers.Status(pool))
}
