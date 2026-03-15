package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangrianet/backend/dbEngine"
	"sangrianet/backend/x402"
)

const maxTimeoutSeconds = 60

// GeneratePayment handles POST /payments/generate-payment.
// Creates a pending payment and returns x402 PaymentRequired object.
func GeneratePayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		merchant := c.Locals("merchant").(dbengine.Merchant)

		var req struct {
			Amount      int64  `json:"amount"`
			Currency    string `json:"currency"`
			Network     string `json:"network"`
			Description string `json:"description"`
			Resource    string `json:"resource"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		if req.Amount <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "amount must be positive"})
		}

		// Look up network config for CAIP-2 and USDC address.
		netConfig, ok := x402.NetworkConfigs[req.Network]
		if !ok {
			return c.Status(400).JSON(fiber.Map{"error": "unsupported network"})
		}

		// Pick LRU wallet on the requested network.
		wallet, err := dbengine.SelectLRUWallet(c.Context(), pool, dbengine.Network(req.Network))
		if err != nil {
			log.Printf("select lru wallet: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "no wallets available for this network"})
		}

		// Create payment record.
		expiresAt := time.Now().Add(maxTimeoutSeconds * time.Second)
		idempotencyKey := fmt.Sprintf("x402-%s", generateUUID())

		payment, err := dbengine.CreatePayment(
			c.Context(), pool,
			merchant.ID, wallet.ID,
			req.Amount, dbengine.Network(req.Network),
			idempotencyKey, expiresAt,
		)
		if err != nil {
			log.Printf("create payment: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create payment"})
		}

		// Build PaymentRequired response.
		return c.Status(200).JSON(fiber.Map{
			"payment_id":  payment.ID,
			"x402Version": 1,
			"accepts": []x402.PaymentRequirements{
				{
					Scheme:            "exact",
					Network:           netConfig.CAIP2,
					MaxAmountRequired: strconv.FormatInt(req.Amount, 10),
					Asset:             netConfig.USDCAddress,
					PayTo:             wallet.Address,
					MaxTimeoutSeconds: maxTimeoutSeconds,
					Extra: map[string]any{
						"name":                "USDC",
						"version":             "1",
						"assetTransferMethod": "eip3009",
					},
				},
			},
			"description": req.Description,
			"resource":    req.Resource,
		})
	}
}

// SettlePayment handles POST /payments/settle-payment.
// Verifies and settles an x402 payment, credits merchant's virtual wallet.
func SettlePayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		merchant := c.Locals("merchant").(dbengine.Merchant)

		var req struct {
			PaymentID           string                  `json:"payment_id"`
			PaymentPayload      string                  `json:"payment_payload"`
			PaymentRequirements x402.PaymentRequirements `json:"payment_requirements"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		// Look up payment record.
		payment, err := dbengine.GetPaymentByID(c.Context(), pool, req.PaymentID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "payment not found"})
		}

		// Verify payment belongs to this merchant.
		if payment.MerchantID != merchant.ID {
			return c.Status(403).JSON(fiber.Map{"error": "payment does not belong to this merchant"})
		}

		// Verify payment is pending.
		if payment.Status != dbengine.PaymentStatusPending {
			return c.Status(400).JSON(fiber.Map{"error": fmt.Sprintf("payment is %s, not pending", payment.Status)})
		}

		// Check expiry.
		if dbengine.IsPaymentExpired(payment) {
			dbengine.UpdatePaymentExpired(c.Context(), pool, payment.ID)
			return c.Status(400).JSON(fiber.Map{"error": "payment has expired"})
		}

		// Validate payment_requirements against payment record.
		wallet, err := dbengine.GetCryptoWalletByID(c.Context(), pool, payment.CryptoWalletID)
		if err != nil {
			log.Printf("get crypto wallet: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to look up payment wallet"})
		}

		if req.PaymentRequirements.PayTo != wallet.Address {
			return c.Status(400).JSON(fiber.Map{"error": "payTo address mismatch — possible fund redirection attack"})
		}

		reqAmount, err := strconv.ParseInt(req.PaymentRequirements.MaxAmountRequired, 10, 64)
		if err != nil || reqAmount != payment.Amount {
			return c.Status(400).JSON(fiber.Map{"error": "amount mismatch"})
		}

		// Decode base64 payment payload.
		payloadBytes, err := base64.StdEncoding.DecodeString(req.PaymentPayload)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment_payload encoding"})
		}

		var payload map[string]any
		if err := json.Unmarshal(payloadBytes, &payload); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment_payload JSON"})
		}

		// Call facilitator /verify.
		verifyResp, err := x402.Verify(c.Context(), payload, req.PaymentRequirements)
		if err != nil {
			log.Printf("facilitator verify error: %v", err)
			dbengine.UpdatePaymentFailed(c.Context(), pool, payment.ID)
			return c.Status(502).JSON(fiber.Map{
				"success":       false,
				"payment_id":    payment.ID,
				"error_reason":  "verify_failed",
				"error_message": "facilitator verification failed",
			})
		}

		if !verifyResp.IsValid {
			dbengine.UpdatePaymentFailed(c.Context(), pool, payment.ID)
			return c.Status(400).JSON(fiber.Map{
				"success":       false,
				"payment_id":    payment.ID,
				"error_reason":  verifyResp.InvalidReason,
				"error_message": verifyResp.InvalidMessage,
			})
		}

		// Call facilitator /settle.
		settleResp, err := x402.Settle(c.Context(), payload, req.PaymentRequirements)
		if err != nil {
			log.Printf("facilitator settle error: %v", err)
			dbengine.UpdatePaymentFailed(c.Context(), pool, payment.ID)
			return c.Status(502).JSON(fiber.Map{
				"success":       false,
				"payment_id":    payment.ID,
				"error_reason":  "settle_failed",
				"error_message": "facilitator settlement failed",
			})
		}

		if !settleResp.Success {
			dbengine.UpdatePaymentFailed(c.Context(), pool, payment.ID)
			return c.Status(400).JSON(fiber.Map{
				"success":       false,
				"payment_id":    payment.ID,
				"error_reason":  settleResp.ErrorReason,
				"error_message": settleResp.ErrorMessage,
			})
		}

		// Step 8a: Update payment record FIRST (safety net).
		payer := settleResp.Payer
		if err := dbengine.UpdatePaymentSettled(c.Context(), pool, payment.ID, settleResp.Transaction, payer); err != nil {
			log.Printf("update payment settled: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to update payment record"})
		}

		// Step 8b-d: Create double-entry ledger transaction.
		merchantAcct, err := dbengine.GetMerchantUSDCLiabilityAccount(c.Context(), pool, merchant.ID)
		if err != nil {
			log.Printf("get merchant liability account: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to look up merchant account"})
		}

		_, err = dbengine.InsertTransaction(c.Context(), pool, payment.IdempotencyKey, []dbengine.LedgerLine{
			{Currency: dbengine.USDC, Amount: payment.Amount, Direction: dbengine.Debit, AccountID: wallet.AccountID},
			{Currency: dbengine.USDC, Amount: payment.Amount, Direction: dbengine.Credit, AccountID: merchantAcct.ID},
		})
		if err != nil {
			log.Printf("insert ledger transaction: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create ledger entry"})
		}

		return c.Status(200).JSON(fiber.Map{
			"success":     true,
			"payment_id":  payment.ID,
			"transaction": settleResp.Transaction,
			"network":     string(payment.Network),
			"payer":       payer,
		})
	}
}
