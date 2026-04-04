package merchantHandlers

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangrianet/backend/dbEngine"
	x402Handlers "sangrianet/backend/x402Handlers"
)

const maxTimeoutSeconds = 60

// GeneratePayment handles POST /payments/generate-payment.
// Creates a pending payment and returns x402 PaymentRequired object.
func GeneratePayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		merchant := c.Locals("merchant_api_key").(*dbengine.Merchant)

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

		if req.Currency != "USDC" {
			return c.Status(400).JSON(fiber.Map{"error": "only USDC is supported"})
		}

		// Look up network config for CAIP-2 and USDC address.
		netConfig, ok := x402Handlers.NetworkConfigs[req.Network]
		if !ok {
			return c.Status(400).JSON(fiber.Map{"error": "unsupported network"})
		}
		if !netConfig.IsEVM() {
			return c.Status(400).JSON(fiber.Map{"error": "only EVM networks are supported for payments"})
		}

		// Pick LRU wallet on the requested network.
		wallet, err := dbengine.SelectLRUWallet(c.Context(), pool, dbengine.Network(req.Network))
		if err != nil {
			log.Printf("select lru wallet: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "no wallets available for this network"})
		}

		// Create payment record.
		expiresAt := time.Now().Add(maxTimeoutSeconds * time.Second)
		idempotencyKey := fmt.Sprintf("x402-%s", uuid.New().String())

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
			"accepts": []x402Handlers.PaymentRequirements{
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
			"resource": x402Handlers.ResourceInfo{
				URL:         req.Resource,
				Description: req.Description,
			},
		})
	}
}

// SettlePayment handles POST /payments/settle-payment.
// Verifies and settles an x402 payment, credits merchant's virtual wallet.
func SettlePayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		merchant := c.Locals("merchant_api_key").(*dbengine.Merchant)

		var req struct {
			PaymentID      string `json:"payment_id"`
			PaymentPayload string `json:"payment_payload"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		// Atomically claim the pending payment with a row lock.
		// Prevents concurrent requests from both starting facilitator calls.
		payment, release, err := dbengine.ClaimPendingPayment(c.Context(), pool, req.PaymentID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return c.Status(404).JSON(fiber.Map{"error": "payment not found or not pending"})
			}
			log.Printf("claim pending payment: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to claim payment"})
		}
		defer release()

		// Verify payment belongs to this merchant.
		if payment.MerchantID != merchant.ID {
			return c.Status(403).JSON(fiber.Map{"error": "payment does not belong to this merchant"})
		}

		// Check expiry.
		if dbengine.IsPaymentExpired(payment) {
			if err := dbengine.UpdatePaymentExpired(c.Context(), pool, payment.ID); err != nil {
				log.Printf("update payment expired: %v", err)
			}
			return c.Status(400).JSON(fiber.Map{"error": "payment has expired"})
		}

		// Build canonical payment requirements server-side from trusted data.
		// Never forward the client-provided req.PaymentRequirements to the facilitator —
		// a malicious client could tamper with Asset, Network, Scheme, etc.
		wallet, err := dbengine.GetCryptoWalletByID(c.Context(), pool, payment.CryptoWalletID)
		if err != nil {
			log.Printf("get crypto wallet: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to look up payment wallet"})
		}

		netConfig, ok := x402Handlers.NetworkConfigs[string(payment.Network)]
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "network config not found for payment"})
		}
		if !netConfig.IsEVM() {
			return c.Status(500).JSON(fiber.Map{"error": "payment network does not support EVM settlement"})
		}

		canonicalRequirements := x402Handlers.PaymentRequirements{
			Scheme:            "exact",
			Network:           netConfig.CAIP2,
			MaxAmountRequired: strconv.FormatInt(payment.Amount, 10),
			Asset:             netConfig.USDCAddress,
			PayTo:             wallet.Address,
			MaxTimeoutSeconds: maxTimeoutSeconds,
			Extra: map[string]any{
				"name":                "USDC",
				"version":             "1",
				"assetTransferMethod": "eip3009",
			},
		}

		// Decode base64 payment payload and preserve as raw JSON to avoid
		// numeric coercion (e.g., large integers in crypto signatures).
		payloadBytes, err := base64.StdEncoding.DecodeString(req.PaymentPayload)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment_payload encoding"})
		}

		// Validate it's valid JSON without deserializing.
		if !json.Valid(payloadBytes) {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment_payload JSON"})
		}
		payload := json.RawMessage(payloadBytes)

		// Call facilitator /verify.
		verifyResp, err := x402Handlers.Verify(c.Context(), payload, canonicalRequirements)
		if err != nil {
			log.Printf("facilitator verify error: %v", err)
			if err := dbengine.UpdatePaymentFailed(c.Context(), pool, payment.ID); err != nil {
				log.Printf("update payment failed: %v", err)
			}
			return c.Status(502).JSON(fiber.Map{
				"success":       false,
				"payment_id":    payment.ID,
				"error_reason":  "verify_failed",
				"error_message": "facilitator verification failed",
			})
		}

		if !verifyResp.IsValid {
			if err := dbengine.UpdatePaymentFailed(c.Context(), pool, payment.ID); err != nil {
				log.Printf("update payment failed: %v", err)
			}
			return c.Status(400).JSON(fiber.Map{
				"success":       false,
				"payment_id":    payment.ID,
				"error_reason":  verifyResp.InvalidReason,
				"error_message": verifyResp.InvalidMessage,
			})
		}

		// Call facilitator /settle.
		settleResp, err := x402Handlers.Settle(c.Context(), payload, canonicalRequirements)
		if err != nil {
			log.Printf("facilitator settle error: %v", err)
			if err := dbengine.UpdatePaymentFailed(c.Context(), pool, payment.ID); err != nil {
				log.Printf("update payment failed: %v", err)
			}
			return c.Status(502).JSON(fiber.Map{
				"success":       false,
				"payment_id":    payment.ID,
				"error_reason":  "settle_failed",
				"error_message": "facilitator settlement failed",
			})
		}

		if !settleResp.Success {
			if err := dbengine.UpdatePaymentFailed(c.Context(), pool, payment.ID); err != nil {
				log.Printf("update payment failed: %v", err)
			}
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
