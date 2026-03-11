package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/joho/godotenv"
	"github.com/workos/workos-go/v4/pkg/usermanagement"

	dbengine "sangrianet/backend/dbEngine"
)

// WorkOSUser contains user information from validated session
type WorkOSUser struct {
	ID        string
	Email     string
	FirstName string
	LastName  string
}

// workosAuthMiddleware validates WorkOS session and extracts user info
// This middleware expects the frontend to pass the WorkOS user ID in the Authorization header
// after the frontend has already validated the session with WorkOS AuthKit
func workosAuthMiddleware(c fiber.Ctx) error {
	// Get Authorization header containing user ID
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Authorization header required"})
	}

	// Extract user ID from the header (format: "User user_id")
	userID := strings.TrimPrefix(authHeader, "User ")
	if userID == authHeader || userID == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Valid user ID required in Authorization header"})
	}

	// Get user info from WorkOS using the user ID
	user, err := usermanagement.GetUser(c.Context(), usermanagement.GetUserOpts{
		User: userID,
	})
	if err != nil {
		log.Printf("WorkOS user lookup failed: %v", err)
		return c.Status(401).JSON(fiber.Map{"error": "Invalid user session"})
	}

	// Store validated user info in context
	c.Locals("workos_user", WorkOSUser{
		ID:        user.ID,
		Email:     user.Email,
		FirstName: user.FirstName,
		LastName:  user.LastName,
	})

	return c.Next()
}

func main() {
	// Load .env file if it exists (no error if missing)
	godotenv.Load()

	// WorkOS configuration
	workosAPIKey := os.Getenv("WORKOS_API_KEY")
	if workosAPIKey == "" {
		log.Fatal("WORKOS_API_KEY environment variable is required")
	}
	usermanagement.SetAPIKey(workosAPIKey)

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

	// POST /accounts — create an account (requires authentication)
	app.Post("/accounts", workosAuthMiddleware, func(c fiber.Ctx) error {
		// Get authenticated user from middleware
		user := c.Locals("workos_user").(WorkOSUser)

		// Generate display name from authenticated user data
		owner := user.Email
		if user.FirstName != "" && user.LastName != "" {
			owner = fmt.Sprintf("%s %s", user.FirstName, user.LastName)
		}

		// Generate deterministic account number from WorkOS user ID
		accountNumber := fmt.Sprintf("ACC-%s", strings.ToUpper(user.ID[:8]))

		// Create account using verified user data only
		account, err := dbengine.InsertAccount(c.Context(), pool, accountNumber, owner, user.ID)
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
