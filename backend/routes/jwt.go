package routes

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/adminHandlers"
	"sangria/backend/apiKeyRequestHandlers"
	"sangria/backend/auth"
	"sangria/backend/merchantHandlers"
	"sangria/backend/organizationHandlers"
)

func RegisterJWTRoutes(app *fiber.App, pool *pgxpool.Pool) {
	internal := app.Group("/internal", auth.WorkosAuthMiddleware)

	internal.Post("/users", auth.CreateUser(pool))

	// Organization management
	organizations := internal.Group("/organizations")
	organizations.Post("/", organizationHandlers.CreateOrganization(pool))
	organizations.Get("/", organizationHandlers.ListUserOrganizations(pool))
	organizations.Post("/:id/invitations", organizationHandlers.InviteMember(pool))
	organizations.Get("/:id/invitations", organizationHandlers.ListPendingInvitations(pool))

	// Invitation acceptance (not organization-specific)
	internal.Post("/invitations/accept", organizationHandlers.AcceptInvitation(pool))

	internal.Get("/balance", merchantHandlers.GetMerchantBalance(pool))
	internal.Get("/transactions", merchantHandlers.GetMerchantTransactions(pool))
	internal.Post("/merchants", adminHandlers.CreateMerchantAPIKey(pool))

	// API Key management
	apiKeys := internal.Group("/api-keys")
	apiKeys.Get("/", auth.ListAPIKeys(pool))
	apiKeys.Delete("/:id", auth.DeleteAPIKey(pool))
	apiKeys.Post("/:id/approve", adminHandlers.ApproveAPIKey(pool))
	apiKeys.Post("/:id/reject", adminHandlers.RejectAPIKey(pool))

	// API Key Requests (for non-admin users to request keys)
	apiKeyRequests := internal.Group("/api-key-requests")
	apiKeyRequests.Post("/", apiKeyRequestHandlers.RequestAPIKey(pool))
	apiKeyRequests.Get("/", apiKeyRequestHandlers.ListAPIKeyRequests(pool))
	apiKeyRequests.Post("/:id/approve", apiKeyRequestHandlers.ApproveAPIKeyRequest(pool))
	apiKeyRequests.Post("/:id/reject", apiKeyRequestHandlers.RejectAPIKeyRequest(pool))

	// Withdrawal endpoints — user picks which merchant account to withdraw from.
	internal.Post("/withdrawals", merchantHandlers.RequestWithdrawal(pool))
	internal.Get("/withdrawals", merchantHandlers.ListWithdrawals(pool))
	internal.Post("/withdrawals/:id/cancel", merchantHandlers.CancelWithdrawal(pool))

	// TODO: Register organization invitation routes.
	// DB functions exist in dbEngine/requests.go, handlers need to be created.
}
