package adminHandlers

import (
	"fmt"
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangria/backend/dbEngine"
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
			Amount int64  `json:"amount"`
			Note   string `json:"note"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		if req.Amount <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "amount must be a positive integer (microunits)"})
		}
		amountMicro := req.Amount

		// Look up system accounts.
		merchantPool, err := dbengine.GetSystemAccount(c.Context(), pool, dbengine.SystemAccountUSDMerchantPool, dbengine.USD)
		if err != nil {
			slog.Error("get USD merchant pool account", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "system account not found"})
		}

		ownerEquity, err := dbengine.GetSystemAccount(c.Context(), pool, dbengine.SystemAccountOwnerEquity, dbengine.USD)
		if err != nil {
			slog.Error("get owner equity account", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "system account not found"})
		}

		// Create ledger transaction with a unique idempotency key.
		idempotencyKey := fmt.Sprintf("treasury-fund-%s", uuid.New().String())

		entries, err := dbengine.InsertTransaction(c.Context(), pool, idempotencyKey, []dbengine.LedgerLine{
			{Currency: dbengine.USD, Amount: amountMicro, Direction: dbengine.Debit, AccountID: merchantPool.ID},
			{Currency: dbengine.USD, Amount: amountMicro, Direction: dbengine.Credit, AccountID: ownerEquity.ID},
		})
		if err != nil {
			slog.Error("insert treasury funding transaction", "idempotency_key", idempotencyKey, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to record funding"})
		}

		slog.Info("treasury funded", "amount_micro", amountMicro, "idempotency_key", idempotencyKey)

		return c.Status(201).JSON(fiber.Map{
			"success":         true,
			"amount_micro":    amountMicro,
			"note":            req.Note,
			"ledger_entries":  len(entries),
			"idempotency_key": idempotencyKey,
		})
	}
}
