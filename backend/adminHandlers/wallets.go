package adminHandlers

import (
	"log"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	cdpHandlers "sangria/backend/cdpHandlers"
	dbengine "sangria/backend/dbEngine"
	x402Handlers "sangria/backend/x402Handlers"
)

// CreateWalletPool handles POST /wallets/pool.
// Creates a new CDP wallet and adds it to the pool (admin-only, WorkOS JWT auth).
func CreateWalletPool(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		var req struct {
			Network string `json:"network"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		// Validate network is supported.
		if _, ok := x402Handlers.NetworkConfigs[req.Network]; !ok {
			return c.Status(400).JSON(fiber.Map{"error": "unsupported network"})
		}

		// Create CDP EVM account on-chain.
		address, err := cdpHandlers.CreateEvmAccount(c.Context())
		if err != nil {
			log.Printf("create evm account: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create wallet"})
		}

		// Create the USDC ASSET ledger account and crypto wallet record
		// in a single transaction — both succeed or both rollback.
		wallet, _, err := dbengine.CreateCryptoWalletWithAccount(
			c.Context(), pool, address, dbengine.Network(req.Network),
			"Hot Wallet USDC - "+address[:10],
		)
		if err != nil {
			log.Printf("create crypto wallet with account: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create wallet record"})
		}

		// Fund with testnet ETH for gas — best-effort after DB records exist.
		if err := cdpHandlers.FundETH(c.Context(), address, req.Network); err != nil {
			log.Printf("fund eth: %v", err)
			// Non-fatal — wallet is created, can be funded later.
		}

		return c.Status(201).JSON(fiber.Map{
			"id":         wallet.ID,
			"address":    wallet.Address,
			"network":    wallet.Network,
			"account_id": wallet.AccountID,
			"created_at": wallet.CreatedAt,
		})
	}
}
