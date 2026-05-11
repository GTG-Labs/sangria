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

const defaultMaxTimeoutSeconds = 60
const maxAllowedTimeoutSeconds = 900

// GeneratePayment handles POST /v1/generate-payment.
// Stateless: looks up the wallet for the network and returns x402 payment terms.
// Supports both "exact" (fixed price, EIP-3009) and "upto" (variable price, Permit2) schemes.
func GeneratePayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		var req struct {
			Amount            int64  `json:"amount"`
			MaxAmount         int64  `json:"max_amount"`
			Scheme            string `json:"scheme"`
			Description       string `json:"description"`
			Resource          string `json:"resource"`
			MaxTimeoutSeconds int    `json:"max_timeout_seconds"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		timeout := defaultMaxTimeoutSeconds
		if req.MaxTimeoutSeconds > 0 {
			timeout = req.MaxTimeoutSeconds
		}
		if timeout > maxAllowedTimeoutSeconds {
			timeout = maxAllowedTimeoutSeconds
		}

		scheme := req.Scheme
		if scheme == "" {
			scheme = "exact"
		}
		if scheme != "exact" && scheme != "upto" {
			return c.Status(400).JSON(fiber.Map{"error": "scheme must be \"exact\" or \"upto\""})
		}

		var amountMicro int64
		switch scheme {
		case "exact":
			if req.Amount <= 0 {
				return c.Status(400).JSON(fiber.Map{"error": "amount must be a positive integer (microunits)"})
			}
			amountMicro = req.Amount
		case "upto":
			if req.MaxAmount <= 0 {
				return c.Status(400).JSON(fiber.Map{"error": "max_amount must be a positive integer (microunits)"})
			}
			amountMicro = req.MaxAmount
		}

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

		slog.Info("generate payment: terms issued", "network", netConfig.CAIP2, "scheme", scheme, "amount_micro", amountMicro)

		requirements := x402Handlers.PaymentRequirements{
			Scheme:            scheme,
			Network:           netConfig.CAIP2,
			Asset:             netConfig.USDCAddress,
			PayTo:             wallet.Address,
			MaxTimeoutSeconds: timeout,
		}

		switch scheme {
		case "exact":
			requirements.Amount = strconv.FormatInt(amountMicro, 10)
			requirements.Extra = map[string]any{
				"name":                "USD Coin",
				"version":             "2",
				"assetTransferMethod": "eip3009",
			}
		case "upto":
			addr := x402Handlers.UptoFacilitatorAddress(netConfig.CAIP2)
			if addr == "" {
				slog.Error("generate payment: no upto facilitator address cached", "network", netConfig.CAIP2)
				return c.Status(503).JSON(fiber.Map{"error": "upto scheme is not currently available on this network"})
			}
			requirements.Amount = strconv.FormatInt(amountMicro, 10)
			requirements.MaxAmountRequired = strconv.FormatInt(amountMicro, 10)
			requirements.Extra = map[string]any{
				"name":                "USD Coin",
				"version":             "2",
				"assetTransferMethod": "permit2",
				"facilitatorAddress":  addr,
			}
		}

		return c.Status(200).JSON(fiber.Map{
			"x402Version": 2,
			"accepts":     []x402Handlers.PaymentRequirements{requirements},
			"resource": x402Handlers.ResourceInfo{
				URL:         req.Resource,
				Description: req.Description,
			},
		})
	}
}

// payloadEnvelope extracts the to address and value from an EIP-3009
// (exact scheme) signed payload without deserializing the entire structure.
type payloadEnvelope struct {
	Payload struct {
		Authorization struct {
			From  string      `json:"from"`
			To    string      `json:"to"`
			Value json.Number `json:"value"`
		} `json:"authorization"`
	} `json:"payload"`
}

// permit2PayloadEnvelope extracts the merchant address and max authorized
// amount from a Permit2 (upto scheme) signed payload.
type permit2PayloadEnvelope struct {
	Payload struct {
		Permit2Authorization struct {
			From      string `json:"from"`
			Permitted struct {
				Token  string      `json:"token"`
				Amount json.Number `json:"amount"`
			} `json:"permitted"`
			Spender  string      `json:"spender"`
			Nonce    json.Number `json:"nonce"`
			Deadline json.Number `json:"deadline"`
			Witness  struct {
				To         string      `json:"to"`
				Facilitator string     `json:"facilitator"`
				ValidAfter json.Number `json:"validAfter"`
			} `json:"witness"`
		} `json:"permit2Authorization"`
	} `json:"payload"`
}

// acceptedTimeoutEnvelope extracts maxTimeoutSeconds from the accepted
// field of a decoded payment payload. The agent echoes the original
// PaymentRequirements in accepted, so verify/settle must use the same
// timeout that was generated rather than a hardcoded default.
type acceptedTimeoutEnvelope struct {
	Accepted struct {
		MaxTimeoutSeconds int `json:"maxTimeoutSeconds"`
	} `json:"accepted"`
}

// VerifyPayment handles POST /v1/verify-payment.
// Stateless: verifies a Permit2 (upto scheme) payment authorization with the
// facilitator without touching the ledger. The SDK calls this before running
// the merchant's handler so expensive business logic only executes after
// confirming the agent's authorization is valid.
func VerifyPayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		var req struct {
			PaymentPayload string `json:"payment_payload"`
			Scheme         string `json:"scheme"`
			MaxAmount      int64  `json:"max_amount"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		if req.Scheme != "upto" {
			return c.Status(400).JSON(fiber.Map{"error": "verify-payment only supports the \"upto\" scheme"})
		}
		if req.MaxAmount <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "max_amount must be a positive integer (microunits)"})
		}

		payloadBytes, err := base64.StdEncoding.DecodeString(req.PaymentPayload)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment_payload encoding"})
		}
		if !json.Valid(payloadBytes) {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment_payload JSON"})
		}

		var envelope permit2PayloadEnvelope
		dec := json.NewDecoder(bytes.NewReader(payloadBytes))
		dec.UseNumber()
		if err := dec.Decode(&envelope); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment payload structure"})
		}

		toAddress := envelope.Payload.Permit2Authorization.Witness.To
		if toAddress == "" {
			return c.Status(400).JSON(fiber.Map{"error": "missing witness.to in permit2 payload"})
		}

		wallet, err := dbengine.GetWalletByAddress(c.Context(), pool, toAddress)
		if err != nil {
			if errors.Is(err, dbengine.ErrWalletNotFound) {
				return c.Status(400).JSON(fiber.Map{"error": "recipient address not recognized"})
			}
			slog.Error("verify payment: get wallet by address", "to_address", toAddress, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to look up wallet"})
		}

		netConfig, ok := x402Handlers.NetworkConfigs[string(wallet.Network)]
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "network config not found for wallet"})
		}

		timeout := defaultMaxTimeoutSeconds
		var acceptedTimeout acceptedTimeoutEnvelope
		if err := json.Unmarshal(payloadBytes, &acceptedTimeout); err == nil && acceptedTimeout.Accepted.MaxTimeoutSeconds > 0 {
			timeout = acceptedTimeout.Accepted.MaxTimeoutSeconds
		}

		canonicalRequirements := x402Handlers.PaymentRequirements{
			Scheme:            "upto",
			Network:           netConfig.CAIP2,
			Amount:            strconv.FormatInt(req.MaxAmount, 10),
			MaxAmountRequired: strconv.FormatInt(req.MaxAmount, 10),
			Asset:             netConfig.USDCAddress,
			PayTo:             wallet.Address,
			MaxTimeoutSeconds: timeout,
			Extra: map[string]any{
				"name":                "USD Coin",
				"version":             "2",
				"assetTransferMethod": "permit2",
			},
		}

		payload := json.RawMessage(payloadBytes)

		slog.Info("verify payment: calling facilitator", "network", netConfig.CAIP2, "max_amount_micro", req.MaxAmount)
		verifyResp, err := x402Handlers.Verify(c.Context(), payload, canonicalRequirements)
		if err != nil {
			slog.Error("verify payment: facilitator error", "error", err)
			return c.Status(502).JSON(fiber.Map{
				"valid":   false,
				"reason":  "verify_failed",
				"message": "facilitator verification failed",
			})
		}

		if !verifyResp.IsValid {
			slog.Warn("verify payment: rejected",
				"reason", verifyResp.InvalidReason,
				"message", verifyResp.InvalidMessage)
			return c.Status(200).JSON(fiber.Map{
				"valid":   false,
				"reason":  verifyResp.InvalidReason,
				"message": verifyResp.InvalidMessage,
			})
		}

		slog.Info("verify payment: valid", "payer", verifyResp.Payer)
		return c.Status(200).JSON(fiber.Map{
			"valid": true,
			"payer": verifyResp.Payer,
		})
	}
}

// ledgerAccounts holds the pre-validated accounts needed for a payment settlement.
type ledgerAccounts struct {
	merchant     dbengine.Account
	convClrUSDC  dbengine.Account
	convClrUSD   dbengine.Account
	feeRevenue   dbengine.Account
}

func lookupLedgerAccounts(c fiber.Ctx, pool *pgxpool.Pool, merchantID string) (*ledgerAccounts, error) {
	merchantAcct, err := dbengine.GetMerchantUSDLiabilityAccount(c.Context(), pool, merchantID)
	if err != nil {
		slog.Error("get merchant liability account", "merchant_id", merchantID, "error", err)
		return nil, err
	}
	convClearingUSDC, err := dbengine.GetSystemAccount(c.Context(), pool, dbengine.SystemAccountConversionClearing, dbengine.USDC)
	if err != nil {
		slog.Error("get conversion clearing account", "currency", "USDC", "error", err)
		return nil, err
	}
	convClearingUSD, err := dbengine.GetSystemAccount(c.Context(), pool, dbengine.SystemAccountConversionClearing, dbengine.USD)
	if err != nil {
		slog.Error("get conversion clearing account", "currency", "USD", "error", err)
		return nil, err
	}
	revenueAcct, err := dbengine.GetSystemAccount(c.Context(), pool, dbengine.SystemAccountPlatformFeeRevenue, dbengine.USD)
	if err != nil {
		slog.Error("get platform fee revenue account", "error", err)
		return nil, err
	}
	return &ledgerAccounts{
		merchant:    merchantAcct,
		convClrUSDC: convClearingUSDC,
		convClrUSD:  convClearingUSD,
		feeRevenue:  revenueAcct,
	}, nil
}

func buildLedgerLines(chargeAmount, fee int64, walletAccountID string, accts *ledgerAccounts) []dbengine.LedgerLine {
	merchantAmount := chargeAmount - fee
	lines := []dbengine.LedgerLine{
		{Currency: dbengine.USDC, Amount: chargeAmount, Direction: dbengine.Debit, AccountID: walletAccountID},
		{Currency: dbengine.USDC, Amount: chargeAmount, Direction: dbengine.Credit, AccountID: accts.convClrUSDC.ID},
		{Currency: dbengine.USD, Amount: chargeAmount, Direction: dbengine.Debit, AccountID: accts.convClrUSD.ID},
		{Currency: dbengine.USD, Amount: merchantAmount, Direction: dbengine.Credit, AccountID: accts.merchant.ID},
	}
	if fee > 0 {
		lines = append(lines, dbengine.LedgerLine{
			Currency: dbengine.USD, Amount: fee, Direction: dbengine.Credit, AccountID: accts.feeRevenue.ID,
		})
	}
	return lines
}

// confirmAndRespond handles the post-settle ledger confirmation and builds
// the success/error HTTP response. Shared between exact and upto paths.
func confirmAndRespond(c fiber.Ctx, pool *pgxpool.Pool, txn dbengine.Transaction, settleResp *x402Handlers.SettleResponse, networkCAIP2 string, logger *slog.Logger) error {
	if err := dbengine.ConfirmTransaction(c.Context(), pool, txn.ID, settleResp.Transaction); err != nil {
		switch {
		case errors.Is(err, dbengine.ErrTransactionNotPending):
			logger.Info("settle payment: transaction already confirmed by concurrent request",
				"tx_hash", settleResp.Transaction)
		case errors.Is(err, dbengine.ErrDuplicateTxHash):
			logger.Error("CRITICAL: tx_hash already bound to another confirmed transaction",
				"txn_id", txn.ID,
				"tx_hash", settleResp.Transaction,
				"idempotency_key", txn.IdempotencyKey,
			)
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
			logger.Error("CRITICAL: confirm ledger transaction failed after on-chain settle",
				"tx_hash", settleResp.Transaction, "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "settlement succeeded but ledger confirmation failed — safe to retry"})
		}
	}

	return c.Status(200).JSON(fiber.Map{
		"success":     true,
		"transaction": settleResp.Transaction,
		"network":     networkCAIP2,
		"payer":       settleResp.Payer,
	})
}

// SettlePayment handles POST /v1/settle-payment.
// Supports both "exact" (EIP-3009) and "upto" (Permit2) schemes.
//
// Exact: extracts amount from the signed payload, verifies + settles in one call.
// Upto: uses settlement_amount from the request body (actual charge ≤ max authorized),
// skips verify (already done via /v1/verify-payment), and settles for the actual amount.
//
// In both cases the handler writes a pending ledger entry BEFORE the facilitator
// call, then confirms it after settlement succeeds.
func SettlePayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		merchant, ok := c.Locals("merchant_api_key").(*dbengine.Merchant)
		if !ok || merchant == nil {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		var req struct {
			PaymentPayload   string `json:"payment_payload"`
			Scheme           string `json:"scheme"`
			SettlementAmount *int64 `json:"settlement_amount"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		scheme := req.Scheme
		if scheme == "" {
			scheme = "exact"
		}
		if scheme != "exact" && scheme != "upto" {
			return c.Status(400).JSON(fiber.Map{"error": "scheme must be \"exact\" or \"upto\""})
		}

		slog.Info("settle payment: received",
			"merchant_id", merchant.ID,
			"scheme", scheme,
			"payload_len", len(req.PaymentPayload),
		)

		// ── 1. Parse & validate payload ──────────────────────────────────

		payloadBytes, err := base64.StdEncoding.DecodeString(req.PaymentPayload)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment_payload encoding"})
		}
		if !json.Valid(payloadBytes) {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment_payload JSON"})
		}

		slog.Debug("settle payment: decoded payload", "payload", string(payloadBytes))

		// ── 2. Extract wallet address + amounts (scheme-dependent) ───────

		var (
			toAddress        string
			chargeAmount     int64  // the amount used for ledger lines + fee
			maxAuthorizedStr string // upto only: max authorized from Permit2 envelope
		)
		var canonicalRequirements x402Handlers.PaymentRequirements

		switch scheme {
		case "exact":
			var envelope payloadEnvelope
			dec := json.NewDecoder(bytes.NewReader(payloadBytes))
			dec.UseNumber()
			if err := dec.Decode(&envelope); err != nil {
				return c.Status(400).JSON(fiber.Map{"error": "invalid payment payload structure"})
			}
			toAddress = envelope.Payload.Authorization.To
			valueStr := envelope.Payload.Authorization.Value.String()
			if toAddress == "" || valueStr == "" {
				return c.Status(400).JSON(fiber.Map{"error": "missing to or value in payment payload"})
			}
			amount, err := strconv.ParseInt(valueStr, 10, 64)
			if err != nil || amount <= 0 {
				return c.Status(400).JSON(fiber.Map{"error": "invalid payment amount"})
			}
			if amount > config.PaymentConfig.MaxAmountMicrounits {
				return c.Status(400).JSON(fiber.Map{"error": "payment amount exceeds maximum"})
			}
			chargeAmount = amount

		case "upto":
			var envelope permit2PayloadEnvelope
			dec := json.NewDecoder(bytes.NewReader(payloadBytes))
			dec.UseNumber()
			if err := dec.Decode(&envelope); err != nil {
				return c.Status(400).JSON(fiber.Map{"error": "invalid permit2 payment payload structure"})
			}
			toAddress = envelope.Payload.Permit2Authorization.Witness.To
			maxAuthorizedStr = envelope.Payload.Permit2Authorization.Permitted.Amount.String()
			if toAddress == "" || maxAuthorizedStr == "" {
				return c.Status(400).JSON(fiber.Map{"error": "missing witness.to or permitted.amount in permit2 payload"})
			}
			maxAuthorized, err := strconv.ParseInt(maxAuthorizedStr, 10, 64)
			if err != nil || maxAuthorized <= 0 {
				return c.Status(400).JSON(fiber.Map{"error": "invalid max authorized amount"})
			}
			if req.SettlementAmount == nil {
				return c.Status(400).JSON(fiber.Map{"error": "settlement_amount is required for upto scheme"})
			}
			settlementAmount := *req.SettlementAmount
			if settlementAmount <= 0 {
				return c.Status(400).JSON(fiber.Map{"error": "settlement_amount must be positive"})
			}
			if settlementAmount > maxAuthorized {
				return c.Status(400).JSON(fiber.Map{"error": "settlement_amount exceeds max authorized amount"})
			}
			if settlementAmount > config.PaymentConfig.MaxAmountMicrounits {
				return c.Status(400).JSON(fiber.Map{"error": "settlement_amount exceeds maximum"})
			}
			chargeAmount = settlementAmount
		}

		// ── 3. Lookup wallet, build requirements ─────────────────────────

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

		settleTimeout := defaultMaxTimeoutSeconds
		var acceptedTimeout acceptedTimeoutEnvelope
		if err := json.Unmarshal(payloadBytes, &acceptedTimeout); err == nil && acceptedTimeout.Accepted.MaxTimeoutSeconds > 0 {
			settleTimeout = acceptedTimeout.Accepted.MaxTimeoutSeconds
		}

		switch scheme {
		case "exact":
			canonicalRequirements = x402Handlers.PaymentRequirements{
				Scheme:            "exact",
				Network:           netConfig.CAIP2,
				Amount:            strconv.FormatInt(chargeAmount, 10),
				Asset:             netConfig.USDCAddress,
				PayTo:             wallet.Address,
				MaxTimeoutSeconds: settleTimeout,
				Extra: map[string]any{
					"name":                "USD Coin",
					"version":             "2",
					"assetTransferMethod": "eip3009",
				},
			}
		case "upto":
			canonicalRequirements = x402Handlers.PaymentRequirements{
				Scheme:            "upto",
				Network:           netConfig.CAIP2,
				MaxAmountRequired: maxAuthorizedStr,
				Amount:            strconv.FormatInt(chargeAmount, 10),
				Asset:             netConfig.USDCAddress,
				PayTo:             wallet.Address,
				MaxTimeoutSeconds: settleTimeout,
				Extra: map[string]any{
					"name":                "USD Coin",
					"version":             "2",
					"assetTransferMethod": "permit2",
				},
			}
		}

		payload := json.RawMessage(payloadBytes)

		// ── 4. Pre-validate all ledger accounts ──────────────────────────

		accts, err := lookupLedgerAccounts(c, pool, merchant.ID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "system account not found"})
		}

		// ── 5. Compute deterministic idempotency key from payload ────────

		hash := sha256.Sum256(payloadBytes)
		payloadKey := "payment-" + hex.EncodeToString(hash[:])

		// ── 6. Build ledger lines ────────────────────────────────────────

		fee, err := config.PlatformFee.CalculateFee(chargeAmount)
		if err != nil {
			slog.Error("settle payment: fee calculation failed", "amount_micro", chargeAmount, "error", err)
			return c.Status(500).JSON(fiber.Map{
				"error":        "internal error calculating fee",
				"error_reason": "fee_calculation_failed",
			})
		}
		merchantAmount := chargeAmount - fee
		if merchantAmount <= 0 {
			slog.Error("settle payment: fee exceeds payment amount", "amount_micro", chargeAmount, "fee_micro", fee)
			return c.Status(400).JSON(fiber.Map{"error": "payment amount too small to cover platform fee"})
		}

		lines := buildLedgerLines(chargeAmount, fee, wallet.AccountID, accts)

		// ── 7. Insert pending ledger transaction ─────────────────────────

		txn, _, err := dbengine.InsertPendingTransaction(c.Context(), pool, payloadKey, dbengine.PaymentScheme(scheme), lines)
		if errors.Is(err, dbengine.ErrAlreadySettled) {
			var storedTxHash string
			if txn.TxHash != nil {
				storedTxHash = *txn.TxHash
			}
			return c.Status(200).JSON(fiber.Map{
				"success":     true,
				"transaction": storedTxHash,
				"network":     netConfig.CAIP2,
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

		logger := slog.With(
			"merchant_id", merchant.ID,
			"txn_id", txn.ID,
			"network", netConfig.CAIP2,
			"scheme", scheme,
			"charge_micro", chargeAmount,
			"fee_micro", fee,
		)

		// ── 8. Verify with facilitator (exact only) ──────────────────────
		// Upto skips verify here — it was already done via /v1/verify-payment.

		if scheme == "exact" {
			logger.Info("settle payment: calling verify")
			verifyResp, err := x402Handlers.Verify(c.Context(), payload, canonicalRequirements)
			if err != nil {
				logger.Error("settle payment: verify error", "error", err)
				return c.Status(502).JSON(fiber.Map{
					"success":       false,
					"error_reason":  "verify_failed",
					"error_message": "facilitator verification failed",
				})
			}
			if !verifyResp.IsValid {
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
		}

		// ── 9. Settle with facilitator ───────────────────────────────────

		logger.Info("settle payment: calling settle")
		settleResp, err := x402Handlers.Settle(c.Context(), payload, canonicalRequirements)
		if err != nil {
			logger.Error("settle payment: settle error", "error", err)
			return c.Status(502).JSON(fiber.Map{
				"success":       false,
				"error_reason":  "settle_failed",
				"error_message": "facilitator settlement failed",
			})
		}
		if !settleResp.Success {
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

		// ── 10. Confirm the pending ledger transaction ───────────────────

		return confirmAndRespond(c, pool, txn, settleResp, netConfig.CAIP2, logger)
	}
}
