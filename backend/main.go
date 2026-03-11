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
	app.Post("/liabilities", func(c fiber.Ctx) error {
		var body struct {
			Name     string `json:"name"`
			Currency string `json:"currency"`
			UserID   string `json:"user_id"`
		}
		if err := c.Bind().JSON(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid JSON body"})
		}
		if body.Name == "" || body.Currency == "" || body.UserID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "name, currency, and user_id are required"})
		}
		liability, err := dbengine.InsertLiability(c.Context(), pool, body.Name, body.Currency, body.UserID)
		if err != nil {
			log.Printf("insert liability error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create liability"})
		}
		return c.Status(201).JSON(liability)
	})

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
	app.Post("/expenses", func(c fiber.Ctx) error {
		var body struct {
			Name     string `json:"name"`
			Currency string `json:"currency"`
		}
		if err := c.Bind().JSON(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid JSON body"})
		}
		if body.Name == "" || body.Currency == "" {
			return c.Status(400).JSON(fiber.Map{"error": "name and currency are required"})
		}
		expense, err := dbengine.InsertExpense(c.Context(), pool, body.Name, body.Currency)
		if err != nil {
			log.Printf("insert expense error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create expense"})
		}
		return c.Status(201).JSON(expense)
	})

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
	app.Post("/revenues", func(c fiber.Ctx) error {
		var body struct {
			Name     string `json:"name"`
			Currency string `json:"currency"`
		}
		if err := c.Bind().JSON(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid JSON body"})
		}
		if body.Name == "" || body.Currency == "" {
			return c.Status(400).JSON(fiber.Map{"error": "name and currency are required"})
		}
		revenue, err := dbengine.InsertRevenue(c.Context(), pool, body.Name, body.Currency)
		if err != nil {
			log.Printf("insert revenue error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create revenue"})
		}
		return c.Status(201).JSON(revenue)
	})

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
	app.Post("/ledger", func(c fiber.Ctx) error {
		var body struct {
			Entries []dbengine.LedgerLine `json:"entries"`
		}
		if err := c.Bind().JSON(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid JSON body"})
		}
		if len(body.Entries) == 0 {
			return c.Status(400).JSON(fiber.Map{"error": "entries array is required and must not be empty"})
		}
		entries, err := dbengine.InsertLedgerEntries(c.Context(), pool, body.Entries)
		if err != nil {
			log.Printf("insert ledger error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to insert ledger entries"})
		}
		return c.Status(201).JSON(entries)
	})

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
