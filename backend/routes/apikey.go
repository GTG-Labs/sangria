package routes

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/auth"
	"sangria/backend/merchantHandlers"
)

func RegisterAPIKeyRoutes(app *fiber.App, pool *pgxpool.Pool) {
	mk := app.Group("/v1", auth.APIKeyAuthMiddleware(pool))

	mk.Post("/generate-payment", merchantHandlers.GeneratePayment(pool))
	mk.Post("/settle-payment", merchantHandlers.SettlePayment(pool))
}
