package adminHandlers

import (
	"fmt"
	"log"
	"math"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangrianet/backend/dbEngine"
)

// FundTreasury handles POST /admin/treasury/fund.
//
// Records a USD deposit into the treasury in the ledger. This endpoint is for
// bookkeeping only — it does NOT move real money. The admin must separately
// deposit the funds into Sangria's actual bank account, then call this endpoint
// to keep the ledger in sync.
//
// Ledger entry:
//   DEBIT   USD Merchant Pool (ASSET)   — the pool has more money
//   CREDIT  Owner Equity (EQUITY)       — the owner put money in
func FundTreasury(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		var req struct {
			Amount float64 `json:"amount"`
			Note   string  `json:"note"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		if math.IsInf(req.Amount, 0) || math.IsNaN(req.Amount) || req.Amount <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "amount must be a positive number"})
		}

		// Convert dollars to microunits.
		rounded := math.Round(req.Amount * 1e6)
		if rounded <= 0 || rounded > float64(math.MaxInt64) {
			return c.Status(400).JSON(fiber.Map{"error": "amount out of range"})
		}
		amountMicro := int64(rounded)

		// Look up system accounts.
		merchantPool, err := dbengine.GetSystemAccount(c.Context(), pool, dbengine.SystemAccountUSDMerchantPool, dbengine.USD)
		if err != nil {
			log.Printf("get USD merchant pool account: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "system account not found"})
		}

		ownerEquity, err := dbengine.GetSystemAccount(c.Context(), pool, dbengine.SystemAccountOwnerEquity, dbengine.USD)
		if err != nil {
			log.Printf("get owner equity account: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "system account not found"})
		}

		// Create ledger transaction with a unique idempotency key.
		idempotencyKey := fmt.Sprintf("treasury-fund-%s", uuid.New().String())

		entries, err := dbengine.InsertTransaction(c.Context(), pool, idempotencyKey, []dbengine.LedgerLine{
			{Currency: dbengine.USD, Amount: amountMicro, Direction: dbengine.Debit, AccountID: merchantPool.ID},
			{Currency: dbengine.USD, Amount: amountMicro, Direction: dbengine.Credit, AccountID: ownerEquity.ID},
		})
		if err != nil {
			log.Printf("insert treasury funding transaction: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to record funding"})
		}

		log.Printf("treasury funded: $%.2f (%d microunits) key=%s note=%q", req.Amount, amountMicro, idempotencyKey, req.Note)

		return c.Status(201).JSON(fiber.Map{
			"success":        true,
			"amount":         req.Amount,
			"amount_micro":   amountMicro,
			"note":           req.Note,
			"ledger_entries": len(entries),
			"idempotency_key": idempotencyKey,
		})
	}
}
