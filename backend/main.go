package main

import (
	"context"
	"log"
	"os"
	"strconv"

	"github.com/gofiber/fiber/v3"
	"github.com/joho/godotenv"

	dbengine "sangrianet/backend/dbEngine"
)

func main() {
	// Load .env file if it exists (no error if missing)
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

	// Add CORS middleware
	app.Use(func(c fiber.Ctx) error {
		c.Set("Access-Control-Allow-Origin", "*")
		c.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if c.Method() == "OPTIONS" {
			return c.SendStatus(200)
		}

		return c.Next()
	})

	app.Get("/", func(c fiber.Ctx) error {
		return c.SendString("Hello, Sangria!")
	})

	// POST /accounts — create an account
	app.Post("/accounts", func(c fiber.Ctx) error {
		// Try both form values and query parameters for flexibility
		accountNumber := c.FormValue("account_number")
		if accountNumber == "" {
			accountNumber = c.Query("account_number")
		}

		owner := c.FormValue("owner")
		if owner == "" {
			owner = c.Query("owner")
		}

		if accountNumber == "" || owner == "" {
			return c.Status(400).JSON(fiber.Map{"error": "account_number and owner are required"})
		}

		account, err := dbengine.InsertAccount(c.Context(), pool, accountNumber, owner)
		if err != nil {
			log.Printf("insert error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create account"})
		}

		return c.Status(201).JSON(account)
	})

	// GET /accounts — list all accounts
	app.Get("/accounts", func(c fiber.Ctx) error {
		accounts, err := dbengine.GetAllAccounts(c.Context(), pool)
		if err != nil {
			log.Printf("query error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch accounts"})
		}

		return c.JSON(accounts)
	})

	// POST /transactions — create a transaction
	app.Post("/transactions", func(c fiber.Ctx) error {
		fromStr := c.Query("from_account")
		toStr := c.Query("to_account")
		value := c.Query("value")
		if fromStr == "" || toStr == "" || value == "" {
			return c.Status(400).JSON(fiber.Map{"error": "from_account, to_account, and value are required"})
		}

		fromAccount, err := strconv.ParseInt(fromStr, 10, 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "from_account must be an integer"})
		}
		toAccount, err := strconv.ParseInt(toStr, 10, 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "to_account must be an integer"})
		}

		txn, err := dbengine.InsertTransaction(c.Context(), pool, fromAccount, toAccount, value)
		if err != nil {
			log.Printf("insert error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create transaction"})
		}

		return c.Status(201).JSON(txn)
	})

	// GET /transactions — list all transactions
	app.Get("/transactions", func(c fiber.Ctx) error {
		txns, err := dbengine.GetAllTransactions(c.Context(), pool)
		if err != nil {
			log.Printf("query error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to fetch transactions"})
		}

		return c.JSON(txns)
	})

	log.Fatal(app.Listen(":8080"))
}
