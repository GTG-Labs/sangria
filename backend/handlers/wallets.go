package handlers

import (
	"log"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangrianet/backend/cdp"
	dbengine "sangrianet/backend/dbEngine"
	"sangrianet/backend/x402"
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
		if _, ok := x402.NetworkConfigs[req.Network]; !ok {
			return c.Status(400).JSON(fiber.Map{"error": "unsupported network"})
		}

		// Create CDP EVM account.
		address, err := cdp.CreateEvmAccount(c.Context())
		if err != nil {
			log.Printf("create evm account: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create wallet"})
		}

		// Fund with testnet ETH for gas.
		if err := cdp.FundETH(c.Context(), address, req.Network); err != nil {
			log.Printf("fund eth: %v", err)
			// Non-fatal — wallet is created, can be funded later.
		}

		// Create USDC ASSET account in ledger for this wallet.
		acct, err := dbengine.CreateAccount(c.Context(), pool,
			"Hot Wallet USDC - "+address[:10],
			dbengine.AccountTypeAsset,
			dbengine.USDC,
			nil,
		)
		if err != nil {
			log.Printf("create asset account: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create ledger account"})
		}

		// Insert into crypto_wallets table.
		wallet, err := dbengine.CreateCryptoWallet(c.Context(), pool, address, dbengine.Network(req.Network), acct.ID)
		if err != nil {
			log.Printf("create crypto wallet: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create wallet record"})
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
