package routes

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/auth"
	"sangria/backend/config"
	"sangria/backend/merchantHandlers"
	"sangria/backend/ratelimit"
)

func RegisterAPIKeyRoutes(app *fiber.App, pool *pgxpool.Pool) {
	// Pre-auth per-IP limiter (counts only failures) catches brute force;
	// post-auth per-API-key limiter throttles authed merchants.
	mk := app.Group("/v1",
		ratelimit.PerIPFailureLimiter(config.RateLimit.AuthFailuresPerMin, "v1-auth-failure"),
		auth.APIKeyAuthMiddleware(pool),
		ratelimit.PerAPIKeyLimiter(config.RateLimit.V1PerMin, "v1-per-apikey"),
	)

	mk.Post("/generate-payment", merchantHandlers.GeneratePayment(pool))
	mk.Post("/settle-payment", merchantHandlers.SettlePayment(pool))
}
