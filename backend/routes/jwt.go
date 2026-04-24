package routes

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/adminHandlers"
	"sangria/backend/auth"
	"sangria/backend/merchantHandlers"
)

func RegisterJWTRoutes(app *fiber.App, pool *pgxpool.Pool) {
	// Public endpoints (no authentication required)
	app.Post("/webhooks/workos", adminHandlers.HandleWorkOSWebhook(pool))
	app.Post("/accept-invitation", adminHandlers.AcceptOrganizationInvitation(pool))

	// Authenticated endpoints (require WorkOS JWT token)
	internal := app.Group("/internal", auth.WorkosAuthMiddleware)

	internal.Post("/users", auth.CreateUser(pool))
	internal.Get("/me", auth.GetCurrentUser(pool))
	internal.Get("/balance", merchantHandlers.GetMerchantBalance(pool))
	internal.Get("/transactions", merchantHandlers.GetMerchantTransactions(pool))
	internal.Post("/merchants", adminHandlers.CreateMerchantAPIKey(pool))

	apiKeys := internal.Group("/api-keys")
	apiKeys.Get("/", auth.ListAPIKeys(pool))
	apiKeys.Delete("/:id", auth.DeleteAPIKey(pool))
	apiKeys.Post("/:id/approve", adminHandlers.ApproveAPIKey(pool))
	apiKeys.Post("/:id/reject", adminHandlers.RejectAPIKey(pool))

	// Withdrawal endpoints — user picks which merchant account to withdraw from.
	internal.Post("/withdrawals", merchantHandlers.RequestWithdrawal(pool))
	internal.Get("/withdrawals", merchantHandlers.ListWithdrawals(pool))
	internal.Post("/withdrawals/:id/cancel", merchantHandlers.CancelWithdrawal(pool))

	// Organization management routes
	organizations := internal.Group("/organizations")
	organizations.Post("/", auth.CreateOrganization(pool))
	organizations.Get("/:id/members", auth.GetOrganizationMembers(pool))
	organizations.Delete("/:id/members/:userId", auth.RemoveOrganizationMember(pool))
	organizations.Post("/:id/invitations", adminHandlers.CreateOrganizationInvitation(pool))
}
