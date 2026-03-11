package main

import (
	"context"
	"log"
	"os"

	"github.com/gofiber/fiber/v3"
	"github.com/joho/godotenv"

	dbengine "sangrianet/backend/dbEngine"
)

func main() {
	godotenv.Load()

	ctx := context.Background()

	connStr := os.Getenv("DATABASE_URL")
	if connStr == "" {
		log.Fatal("DATABASE_URL is not set")
	}

	pool, err := dbengine.Connect(ctx, connStr)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	log.Println("Connected to database")

	app := fiber.New()

	// Health check
	app.Get("/", func(c fiber.Ctx) error {
		return c.SendString("Hello, Sangria!")
	})

	// -----------------------------------------------------------------------
	// Assets
	// -----------------------------------------------------------------------
	app.Get("/assets", func(c fiber.Ctx) error {
		assets, err := dbengine.GetAllAssets(c.Context(), pool)
		if err != nil {
			log.Printf("query assets error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch assets"})
		}
		return c.JSON(assets)
	})

	// -----------------------------------------------------------------------
	// Liabilities
	// -----------------------------------------------------------------------
	app.Get("/liabilities", func(c fiber.Ctx) error {
		liabilities, err := dbengine.GetAllLiabilities(c.Context(), pool)
		if err != nil {
			log.Printf("query liabilities error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch liabilities"})
		}
		return c.JSON(liabilities)
	})

	// -----------------------------------------------------------------------
	// Expenses
	// -----------------------------------------------------------------------
	app.Get("/expenses", func(c fiber.Ctx) error {
		expenses, err := dbengine.GetAllExpenses(c.Context(), pool)
		if err != nil {
			log.Printf("query expenses error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch expenses"})
		}
		return c.JSON(expenses)
	})

	// -----------------------------------------------------------------------
	// Revenues
	// -----------------------------------------------------------------------
	app.Get("/revenues", func(c fiber.Ctx) error {
		revenues, err := dbengine.GetAllRevenues(c.Context(), pool)
		if err != nil {
			log.Printf("query revenues error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch revenues"})
		}
		return c.JSON(revenues)
	})

	// -----------------------------------------------------------------------
	// Ledger
	// -----------------------------------------------------------------------
	app.Get("/ledger", func(c fiber.Ctx) error {
		entries, err := dbengine.GetAllLedgerEntries(c.Context(), pool)
		if err != nil {
			log.Printf("query ledger error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch ledger entries"})
		}
		return c.JSON(entries)
	})

	app.Get("/ledger/:transaction_id", func(c fiber.Ctx) error {
		txID := c.Params("transaction_id")
		entries, err := dbengine.GetLedgerEntriesByTransaction(c.Context(), pool, txID)
		if err != nil {
			log.Printf("query ledger by tx error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch ledger entries"})
		}
		return c.JSON(entries)
	})

	log.Fatal(app.Listen(":3000"))
}
