package main

import (
	"context"
	"log"
	"log/slog"
	"os"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/auth"
	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
	"sangria/backend/routes"
	"sangria/backend/utils"
)

func main() {
	config.LoadEnvironment()

	// Logging must load first so every subsequent loader logs through
	// the configured slog handler.
	if err := config.LoadLoggingConfig(); err != nil {
		// Fall back to the default stdlib logger since slog isn't configured yet.
		log.Fatalf("failed to load logging config: %v", err)
	}
	slog.Info("logging config loaded",
		"level", config.Logging.Level.String(),
		"format", config.Logging.Format,
		"app_env", config.Logging.AppEnv)

	// Wire the auth package's dev-env check against the canonical config.
	auth.IsDevelopmentEnv = config.Logging.IsDevelopment

	if err := config.LoadWorkOSConfig(); err != nil {
		slog.Error("failed to load WorkOS config", "error", err)
		os.Exit(1)
	}
	slog.Info("workos config loaded",
		"client_id", config.WorkOS.ClientID,
		"token_issuer", config.WorkOS.TokenIssuer)

	if err := config.LoadCDPConfig(); err != nil {
		slog.Error("failed to load CDP config", "error", err)
		os.Exit(1)
	}
	slog.Info("cdp config loaded")

	if err := config.LoadEmailConfig(); err != nil {
		slog.Error("failed to load email config", "error", err)
		os.Exit(1)
	}
	slog.Info("email config loaded",
		"from_email", config.Email.ResendFromEmail,
		"frontend_url", config.Email.FrontendURL)

	if err := config.LoadCORSConfig(); err != nil {
		slog.Error("failed to load CORS config", "error", err)
		os.Exit(1)
	}
	slog.Info("cors config loaded", "allowed_origins_count", len(config.CORS.AllowedOrigins))

	if err := config.LoadX402Config(); err != nil {
		slog.Error("failed to load x402 config", "error", err)
		os.Exit(1)
	}
	slog.Info("x402 config loaded", "facilitator_url", config.X402.FacilitatorURL)

	if err := config.SetupWorkOS(); err != nil {
		slog.Error("failed to setup WorkOS", "error", err)
		os.Exit(1)
	}

	if err := config.LoadPlatformFees(); err != nil {
		slog.Error("failed to load platform fees", "error", err)
		os.Exit(1)
	}
	slog.Info("platform fee loaded",
		"rate_bps", config.PlatformFee.RateBasisPoints,
		"min_microunits", config.PlatformFee.MinMicrounits)

	if err := config.LoadWithdrawalConfig(); err != nil {
		slog.Error("failed to load withdrawal config", "error", err)
		os.Exit(1)
	}
	slog.Info("withdrawal config loaded",
		"auto_approve_threshold", config.WithdrawalConfig.AutoApproveThreshold,
		"min_microunits", config.WithdrawalConfig.MinAmount,
		"fee_flat_microunits", config.WithdrawalConfig.FeeFlat)

	if err := config.LoadPaymentConfig(); err != nil {
		slog.Error("failed to load payment config", "error", err)
		os.Exit(1)
	}
	slog.Info("payment config loaded",
		"max_amount_microunits", config.PaymentConfig.MaxAmountMicrounits)

	if err := config.LoadRateLimitConfig(); err != nil {
		slog.Error("failed to load rate limit config", "error", err)
		os.Exit(1)
	}
	slog.Info("rate limit config loaded",
		"v1_per_min", config.RateLimit.V1PerMin,
		"internal_per_min", config.RateLimit.InternalPerMin,
		"admin_per_min", config.RateLimit.AdminPerMin,
		"invitations_per_min", config.RateLimit.InvitationsPerMin,
		"accept_invitation_per_min", config.RateLimit.AcceptInvitationPerMin,
		"auth_failures_per_min", config.RateLimit.AuthFailuresPerMin,
		"disabled", config.RateLimit.Disabled,
		"workos_ip_allowlist_count", len(config.RateLimit.WorkOSWebhookAllowedIPs))

	ctx := context.Background()

	pool, err := config.ConnectDatabase(ctx)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	// Ensure system-level ledger accounts exist (conversion clearing, revenue, expenses).
	if err := dbengine.EnsureSystemAccounts(ctx, pool); err != nil {
		slog.Error("failed to ensure system accounts", "error", err)
		os.Exit(1)
	}

	app := fiber.New(fiber.Config{
		// Trust proxy headers so c.IP() returns something closer to the real
		// client IP than Railway's edge. 0.0.0.0/0 covers Railway's variable
		// proxy IPs; required because Railway's egress ranges are not fixed.
		//
		// CAVEAT — c.IP() is spoofable even behind Railway. Railway's Envoy
		// edge APPENDS the real client IP to any client-supplied
		// X-Forwarded-For, so with Proxies: 0.0.0.0/0 the returned IP honors
		// the leftmost (attacker-controlled) entry. The unspoofable source is
		// X-Envoy-External-Address, which Envoy derives from the TCP peer.
		//
		// Affected call sites (defense-in-depth only; do NOT rely on c.IP()
		// for security boundaries):
		//   - ratelimit.PerIPLimiter, PerIPFailureLimiter, and the IP
		//     fallbacks in PerAPIKeyLimiter / PerUserLimiter — these prefer
		//     X-Envoy-External-Address via ratelimit.clientIP().
		//   - adminHandlers/webhooks.go WorkOS IP allowlist — uses
		//     X-Envoy-External-Address directly.
		//   - slog logging context — informational only.
		//
		// If Railway is ever not the sole ingress, review every c.IP() call
		// site before shipping — direct ingress bypasses all IP-based
		// protections listed above.
		TrustProxy: true,
		TrustProxyConfig: fiber.TrustProxyConfig{
			Loopback:  true,
			LinkLocal: true,
			Private:   true,
			Proxies:   []string{"0.0.0.0/0"},
		},
	})
	utils.SetupCORSMiddleware(app)
	setupRoutes(app, pool)

	port, err := config.GetPort()
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(app.Listen(":" + port))
}

func setupRoutes(app *fiber.App, pool *pgxpool.Pool) {
	routes.RegisterPublicRoutes(app)
	routes.RegisterJWTRoutes(app, pool)
	routes.RegisterAPIKeyRoutes(app, pool)
	routes.RegisterAdminRoutes(app, pool)
}