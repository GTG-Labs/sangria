package main

import (
	"context"
	"log"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
	"sangria/backend/routes"
	"sangria/backend/utils"
)

func main() {
	config.LoadEnvironment()

	if err := config.SetupWorkOS(); err != nil {
		log.Fatalf("Failed to setup WorkOS: %v", err)
	}

	if err := config.LoadPlatformFees(); err != nil {
		log.Fatalf("Failed to load platform fees: %v", err)
	}
	log.Printf("Platform fee: %d basis points (min %d microunits)", config.PlatformFee.RateBasisPoints, config.PlatformFee.MinMicrounits)

	if err := config.LoadWithdrawalConfig(); err != nil {
		log.Fatalf("Failed to load withdrawal config: %v", err)
	}
	log.Printf("Withdrawal: auto-approve <= %d microunits, min %d microunits, fee %d microunits",
		config.WithdrawalConfig.AutoApproveThreshold, config.WithdrawalConfig.MinAmount, config.WithdrawalConfig.FeeFlat)

	ctx := context.Background()

	pool, err := config.ConnectDatabase(ctx)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	// Ensure system-level ledger accounts exist (conversion clearing, revenue, expenses).
	if err := dbengine.EnsureSystemAccounts(ctx, pool); err != nil {
		log.Fatalf("Failed to ensure system accounts: %v", err)
	}

	app := fiber.New()
	utils.SetupCORSMiddleware(app)
	setupRoutes(app, pool)

	log.Fatal(app.Listen(":8080"))
}

func setupRoutes(app *fiber.App, pool *pgxpool.Pool) {
	routes.RegisterPublicRoutes(app)
	routes.RegisterJWTRoutes(app, pool)
	routes.RegisterAPIKeyRoutes(app, pool)
	routes.RegisterAdminRoutes(app, pool)
}