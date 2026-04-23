package routes

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/adminHandlers"
	"sangria/backend/auth"
	"sangria/backend/config"
	"sangria/backend/merchantHandlers"
	"sangria/backend/ratelimit"
)

func RegisterJWTRoutes(app *fiber.App, pool *pgxpool.Pool) {
	// Public endpoints. /webhooks/workos uses an IP allowlist inside the
	// handler; /accept-invitation is per-IP since the token is the only auth.
	app.Post("/webhooks/workos", adminHandlers.HandleWorkOSWebhook(pool))
	app.Post("/accept-invitation",
		ratelimit.PerIPLimiter(config.RateLimit.AcceptInvitationPerMin, "accept-invitation"),
		adminHandlers.AcceptOrganizationInvitation(pool),
	)

	// Authenticated endpoints (WorkOS JWT + CSRF + per-user rate limit).
	internal := app.Group("/internal",
		auth.WorkosAuthMiddleware,
		auth.CSRFMiddleware(),
		ratelimit.PerUserLimiter(config.RateLimit.InternalPerMin, "internal-per-user"),
	)

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

	// Organization routes. Invitations have a tighter per-org limit on top
	// of the per-user bucket because each call sends a paid Resend email.
	organizations := internal.Group("/organizations")
	organizations.Post("/", auth.CreateOrganization(pool))
	organizations.Get("/:id/members", auth.GetOrganizationMembers(pool))
	organizations.Delete("/:id/members/:userId", auth.RemoveOrganizationMember(pool))
	organizations.Post("/:id/invitations",
		ratelimit.PerOrgLimiter(config.RateLimit.InvitationsPerMin, "invitations-per-org"),
		adminHandlers.CreateOrganizationInvitation(pool),
	)
}
