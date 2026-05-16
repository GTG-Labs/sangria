package routes

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/agentHandlers"
	"sangria/backend/auth"
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
	// The /buy purchase flow lands as part of the discovery-model PR; this
	// group currently exposes only the balance lookup.
	agent := v1.Group("/agent", auth.RequireAgentKey)
	agent.Get("/balance", agentHandlers.GetAgentBalance(pool))
}
