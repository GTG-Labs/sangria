package merchantHandlers

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
	x402Handlers "sangria/backend/x402Handlers"
)

const maxTimeoutSeconds = 60

// GeneratePayment handles POST /v1/generate-payment.
// Stateless: looks up the wallet for the network and returns x402 payment terms.
func GeneratePayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		var req struct {
			Amount      int64  `json:"amount"`
			Description string `json:"description"`
			Resource    string `json:"resource"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		if req.Amount <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "amount must be a positive integer (microunits)"})
		}

		// Hardcoded: USDC on Base (change to "base" for mainnet).
		const network = "base"

		netConfig, ok := x402Handlers.NetworkConfigs[network]
		if !ok {
			return c.Status(400).JSON(fiber.Map{"error": "unsupported network"})
		}

		wallet, err := dbengine.GetWalletByNetwork(c.Context(), pool, dbengine.Network(network))
		if err != nil {
			slog.Error("get wallet by network", "network", network, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "no wallet available for this network"})
		}

		slog.Info("generate payment: terms issued", "network", netConfig.CAIP2, "amount_micro", req.Amount)

		return c.Status(200).JSON(fiber.Map{
			"x402Version": 2,
			"accepts": []x402Handlers.PaymentRequirements{
				{
					Scheme:            "exact",
					Network:           netConfig.CAIP2,
					Amount:            strconv.FormatInt(req.Amount, 10),
					Asset:             netConfig.USDCAddress,
					PayTo:             wallet.Address,
					MaxTimeoutSeconds: maxTimeoutSeconds,
					Extra: map[string]any{
						"name":                "USD Coin",
						"version":             "2",
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

// payloadEnvelope is used to extract the to address and value from the
// EIP-712 signed payload without deserializing the entire structure.
type payloadEnvelope struct {
	Payload struct {
		Authorization struct {
			From  string      `json:"from"`
			To    string      `json:"to"`
			Value json.Number `json:"value"`
		} `json:"authorization"`
	} `json:"payload"`
}

// SettlePayment handles POST /v1/settle-payment.
// Extracts the recipient wallet and amount from the signed payload,
// writes a pending ledger entry, verifies and settles via the facilitator,
// then confirms the ledger. This ordering ensures the ledger is never
// missing a record for an on-chain settlement.
//
// TODO: Reconcile against the chain, not the facilitator. Confirm ledger rows
// by querying USDC.authorizationState(from, nonce) on Base directly, and add a
// background job to resolve stale pending rows using on-chain state.
func SettlePayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		merchant, ok := c.Locals("merchant_api_key").(*dbengine.Merchant)
		if !ok || merchant == nil {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		var req struct {
			PaymentPayload string `json:"payment_payload"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		// ── 1. Parse & validate payload ──────────────────────────────────

		payloadBytes, err := base64.StdEncoding.DecodeString(req.PaymentPayload)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment_payload encoding"})
		}
		if !json.Valid(payloadBytes) {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment_payload JSON"})
		}

		var envelope payloadEnvelope
		dec := json.NewDecoder(bytes.NewReader(payloadBytes))
		dec.UseNumber()
		if err := dec.Decode(&envelope); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment payload structure"})
		}

		toAddress := envelope.Payload.Authorization.To
		valueStr := envelope.Payload.Authorization.Value.String()
		if toAddress == "" || valueStr == "" {
			return c.Status(400).JSON(fiber.Map{"error": "missing to or value in payment payload"})
		}

		amount, err := strconv.ParseInt(valueStr, 10, 64)
		if err != nil || amount <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment amount"})
		}
		// Reject absurd amounts before any fee math runs. 
		if amount > config.PaymentConfig.MaxAmountMicrounits {
			return c.Status(400).JSON(fiber.Map{"error": "payment amount exceeds maximum"})
		}

		// ── 2. Lookup wallet, build requirements ─────────────────────────

		wallet, err := dbengine.GetWalletByAddress(c.Context(), pool, toAddress)
		if err != nil {
			if errors.Is(err, dbengine.ErrWalletNotFound) {
				return c.Status(400).JSON(fiber.Map{"error": "recipient address not recognized"})
			}
			slog.Error("get wallet by address", "to_address", toAddress, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to look up wallet"})
		}

		netConfig, ok := x402Handlers.NetworkConfigs[string(wallet.Network)]
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "network config not found for wallet"})
		}

		canonicalRequirements := x402Handlers.PaymentRequirements{
			Scheme:            "exact",
			Network:           netConfig.CAIP2,
			Amount:            valueStr,
			Asset:             netConfig.USDCAddress,
			PayTo:             wallet.Address,
			MaxTimeoutSeconds: maxTimeoutSeconds,
			Extra: map[string]any{
				"name":                "USD Coin",
				"version":             "2",
				"assetTransferMethod": "eip3009",
			},
		}

		payload := json.RawMessage(payloadBytes)

		// ── 3. Pre-validate all ledger accounts ──────────────────────────

		merchantAcct, err := dbengine.GetMerchantUSDLiabilityAccount(c.Context(), pool, merchant.ID)
		if err != nil {
			slog.Error("get merchant liability account", "merchant_id", merchant.ID, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to look up merchant account"})
		}

		convClearingUSDC, err := dbengine.GetSystemAccount(c.Context(), pool, dbengine.SystemAccountConversionClearing, dbengine.USDC)
		if err != nil {
			slog.Error("get conversion clearing account", "currency", "USDC", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "system account not found"})
		}

		convClearingUSD, err := dbengine.GetSystemAccount(c.Context(), pool, dbengine.SystemAccountConversionClearing, dbengine.USD)
		if err != nil {
			slog.Error("get conversion clearing account", "currency", "USD", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "system account not found"})
		}

		revenueAcct, err := dbengine.GetSystemAccount(c.Context(), pool, dbengine.SystemAccountPlatformFeeRevenue, dbengine.USD)
		if err != nil {
			slog.Error("get platform fee revenue account", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "system account not found"})
		}

		// ── 4. Compute deterministic idempotency key from payload ────────

		hash := sha256.Sum256(payloadBytes)
		payloadKey := "payment-" + hex.EncodeToString(hash[:])

		// ── 5. Build ledger lines ────────────────────────────────────────

		fee, err := config.PlatformFee.CalculateFee(amount)
		if err != nil {
			// The amount already passed PaymentConfig.MaxAmountMicrounits upstream,
			// so a CalculateFee failure here is a server-side arithmetic or config
			// problem (e.g. misconfigured RateBasisPoints) — not a client mistake.
			slog.Error("settle payment: fee calculation failed", "amount_micro", amount, "error", err)
			return c.Status(500).JSON(fiber.Map{
				"error":        "internal error calculating fee",
				"error_reason": "fee_calculation_failed",
			})
		}
		merchantAmount := amount - fee
		if merchantAmount <= 0 {
			slog.Error("settle payment: fee exceeds payment amount", "amount_micro", amount, "fee_micro", fee)
			return c.Status(400).JSON(fiber.Map{"error": "payment amount too small to cover platform fee"})
		}

		lines := []dbengine.LedgerLine{
			// USDC side: hot wallet receives, conversion clearing absorbs.
			{Currency: dbengine.USDC, Amount: amount, Direction: dbengine.Debit, AccountID: wallet.AccountID},
			{Currency: dbengine.USDC, Amount: amount, Direction: dbengine.Credit, AccountID: convClearingUSDC.ID},
			// USD side: conversion clearing bridges, merchant + revenue split.
			{Currency: dbengine.USD, Amount: amount, Direction: dbengine.Debit, AccountID: convClearingUSD.ID},
			{Currency: dbengine.USD, Amount: merchantAmount, Direction: dbengine.Credit, AccountID: merchantAcct.ID},
		}
		if fee > 0 {
			lines = append(lines, dbengine.LedgerLine{
				Currency: dbengine.USD, Amount: fee, Direction: dbengine.Credit, AccountID: revenueAcct.ID,
			})
		}

		// ── 6. Insert pending ledger transaction ─────────────────────────
		// Written BEFORE the facilitator call so the ledger is never missing
		// a record for an on-chain settlement. Deduplicates concurrent/replayed
		// requests via the payload-hash idempotency key.

		txn, _, err := dbengine.InsertPendingTransaction(c.Context(), pool, payloadKey, lines)
		if errors.Is(err, dbengine.ErrAlreadySettled) {
			// This payload was already settled — return the stored result.
			// Payer address is not stored (privacy by design) so it's empty on replay.
			var storedTxHash string
			if txn.TxHash != nil {
				storedTxHash = *txn.TxHash
			}
			return c.Status(200).JSON(fiber.Map{
				"success":     true,
				"transaction": storedTxHash,
				"network":     string(wallet.Network),
				"payer":       "",
			})
		}
		if errors.Is(err, dbengine.ErrPreviouslyFailed) {
			return c.Status(400).JSON(fiber.Map{
				"success":       false,
				"error_reason":  "previously_failed",
				"error_message": "this payment payload was previously attempted and failed",
			})
		}
		if err != nil {
			slog.Error("insert pending ledger transaction", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create pending ledger entry"})
		}

		// From here on, txn.ID identifies the pending row. If we return early
		// due to a facilitator failure we mark it as failed.
		logger := slog.With(
			"merchant_id", merchant.ID,
			"txn_id", txn.ID,
			"network", netConfig.CAIP2,
			"amount_micro", amount,
			"fee_micro", fee,
		)

		// ── 7. Verify with facilitator ───────────────────────────────────

		logger.Info("settle payment: calling verify")
		verifyResp, err := x402Handlers.Verify(c.Context(), payload, canonicalRequirements)
		if err != nil {
			// HTTP error (timeout, connection refused) — we don't know if the
			// signature is valid or not. Leave the ledger row as pending so a
			// retry can re-attempt.
			logger.Error("settle payment: verify error", "error", err)
			return c.Status(502).JSON(fiber.Map{
				"success":       false,
				"error_reason":  "verify_failed",
				"error_message": "facilitator verification failed",
			})
		}
		if !verifyResp.IsValid {
			// Definitive rejection — the facilitator explicitly said no.
			// Log the raw facilitator reason but return a sanitized message to the client.
			logger.Warn("settle payment: verify rejected",
				"reason", verifyResp.InvalidReason,
				"message", verifyResp.InvalidMessage)
			if failErr := dbengine.FailTransaction(c.Context(), pool, txn.ID); failErr != nil {
				logger.Warn("settle payment: could not mark transaction as failed", "error", failErr)
			}
			return c.Status(400).JSON(fiber.Map{
				"success":       false,
				"error_reason":  "payment_rejected",
				"error_message": "payment verification was rejected by the network",
			})
		}
		logger.Info("settle payment: verify ok")

		// ── 8. Settle with facilitator ───────────────────────────────────

		logger.Info("settle payment: calling settle")
		settleResp, err := x402Handlers.Settle(c.Context(), payload, canonicalRequirements)
		if err != nil {
			// HTTP error (timeout, connection refused) — we don't know if the
			// on-chain transfer happened or not. Leave the ledger row as pending
			// so a retry can re-attempt and get the definitive outcome.
			logger.Error("settle payment: settle error", "error", err)
			return c.Status(502).JSON(fiber.Map{
				"success":       false,
				"error_reason":  "settle_failed",
				"error_message": "facilitator settlement failed",
			})
		}
		if !settleResp.Success {
			// Definitive rejection — the facilitator explicitly said no.
			// On-chain transfer did NOT happen.
			// Log the raw facilitator reason but return a sanitized message to the client.
			logger.Warn("settle payment: settle rejected",
				"reason", settleResp.ErrorReason,
				"message", settleResp.ErrorMessage)
			if failErr := dbengine.FailTransaction(c.Context(), pool, txn.ID); failErr != nil {
				logger.Warn("settle payment: could not mark transaction as failed", "error", failErr)
			}
			return c.Status(400).JSON(fiber.Map{
				"success":       false,
				"error_reason":  "settlement_rejected",
				"error_message": "payment settlement was rejected by the network",
			})
		}
		logger.Info("settle payment: settled on-chain", "tx", settleResp.Transaction)

		// ── 9. Confirm the pending ledger transaction ────────────────────

		if err := dbengine.ConfirmTransaction(c.Context(), pool, txn.ID, settleResp.Transaction); err != nil {
			switch {
			case errors.Is(err, dbengine.ErrTransactionNotPending):
				// A concurrent request already confirmed this transaction — that's a success.
				logger.Info("settle payment: transaction already confirmed by concurrent request",
					"tx_hash", settleResp.Transaction)
			case errors.Is(err, dbengine.ErrDuplicateTxHash):
				// CRITICAL: another confirmed transaction already claims this tx_hash.
				// The ledger is intact; request failed to commit and needs investigation.
				// 2 pending rows mapped to the same on-chain settlement.
				logger.Error("CRITICAL: tx_hash already bound to another confirmed transaction",
					"txn_id", txn.ID,
					"tx_hash", settleResp.Transaction,
					"idempotency_key", txn.IdempotencyKey,
				)
				// Mark the pending row as failed so future retries with the same
				// idempotency key short-circuit via ErrPreviouslyFailed instead of
				// looping back to this same collision.
				if failErr := dbengine.FailTransaction(c.Context(), pool, txn.ID); failErr != nil {
					logger.Error("CRITICAL: failed to mark collided transaction as failed",
						"txn_id", txn.ID,
						"tx_hash", settleResp.Transaction,
						"idempotency_key", txn.IdempotencyKey,
						"error", failErr,
					)
				}
				return c.Status(500).JSON(fiber.Map{"error": "settlement collision detected — contact support"})
			default:
				// CRITICAL: on-chain settlement succeeded but we couldn't confirm
				// the ledger row. The pending row with its idempotency key remains
				// as a recovery artifact — a retry of the same payload will find it
				// and re-attempt confirmation.
				logger.Error("CRITICAL: confirm ledger transaction failed after on-chain settle",
					"tx_hash", settleResp.Transaction, "error", err)
				return c.Status(500).JSON(fiber.Map{"error": "settlement succeeded but ledger confirmation failed — safe to retry"})
			}
		}

		// ── 10. Return success ───────────────────────────────────────────

		return c.Status(200).JSON(fiber.Map{
			"success":     true,
			"transaction": settleResp.Transaction,
			"network":     string(wallet.Network),
			"payer":       settleResp.Payer,
		})
	}
}
