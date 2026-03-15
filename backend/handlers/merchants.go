package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangrianet/backend/dbEngine"
)

// CreateMerchant handles POST /merchants.
// Creates a merchant API key for a user (admin-only, WorkOS JWT auth).
func CreateMerchant(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		var req struct {
			Name   string `json:"name"`
			UserID string `json:"user_id"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		if req.Name == "" || req.UserID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "name and user_id are required"})
		}

		// Generate a raw API key (shown to user once).
		rawKey, err := generateAPIKey()
		if err != nil {
			log.Printf("generate api key: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to generate api key"})
		}

		merchant, err := dbengine.CreateMerchant(c.Context(), pool, req.UserID, req.Name, rawKey)
		if err != nil {
			log.Printf("create merchant: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create merchant"})
		}

		// Return merchant record + raw key (only shown once).
		return c.Status(201).JSON(fiber.Map{
			"id":         merchant.ID,
			"user_id":    merchant.UserID,
			"name":       merchant.Name,
			"api_key":    rawKey,
			"is_active":  merchant.IsActive,
			"created_at": merchant.CreatedAt,
		})
	}
}

// GetMerchantBalance handles GET /merchants/balance.
// Returns the authenticated merchant's virtual USDC balance.
func GetMerchantBalance(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		merchant := c.Locals("merchant").(dbengine.Merchant)

		balance, err := dbengine.GetMerchantBalance(c.Context(), pool, merchant.ID)
		if err != nil {
			log.Printf("get merchant balance: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to get balance"})
		}

		// Convert microunits to display dollars (1 USDC = 1,000,000 microunits).
		displayBalance := fmt.Sprintf("$%.2f", float64(balance)/1_000_000)

		return c.Status(200).JSON(fiber.Map{
			"balance":         balance,
			"currency":        "USDC",
			"display_balance": displayBalance,
		})
	}
}

// generateAPIKey creates a cryptographically random 32-byte hex API key.
func generateAPIKey() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
