package main

import (
	"context"
	"log"
	"log/slog"
	"os"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
	"sangria/backend/routes"
	"sangria/backend/utils"
)

func main() {
	config.LoadEnvironment()

	// Configure structured logger.
	// LOG_LEVEL: debug | info (default) | warn | error
	// LOG_FORMAT: json | text (default)
	var level slog.Level
	switch os.Getenv("LOG_LEVEL") {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{Level: level}
	var handler slog.Handler
	if os.Getenv("LOG_FORMAT") == "json" {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}
	slog.SetDefault(slog.New(handler))

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
		// Trust proxy headers for secure Protocol() detection in production
		TrustProxy: true,
		TrustProxyConfig: fiber.TrustProxyConfig{
			Loopback: true, // Trust 127.0.0.0/8 and ::1
			LinkLocal: true, // Trust 169.254.0.0/16 and fe80::/10
			Private: true, // Trust 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
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