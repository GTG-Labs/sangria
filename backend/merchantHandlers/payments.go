package merchantHandlers

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"log"
	"math"
	"strconv"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangrianet/backend/dbEngine"
	x402Handlers "sangrianet/backend/x402Handlers"
)

const maxTimeoutSeconds = 60

// GeneratePayment handles POST /v1/generate-payment.
// Stateless: looks up the wallet for the network and returns x402 payment terms.
func GeneratePayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		var req struct {
			Amount      float64 `json:"amount"`
			Description string  `json:"description"`
			Resource    string  `json:"resource"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		// Convert dollar amount to microunits (USDC has 6 decimals).
		if math.IsInf(req.Amount, 0) || math.IsNaN(req.Amount) || req.Amount <= 0 || req.Amount > 9_000_000_000_000 {
			return c.Status(400).JSON(fiber.Map{"error": "amount must be a positive number within a valid range"})
		}
		amountMicro := int64(math.Round(req.Amount * 1e6))

		// Hardcoded: USDC on Base Sepolia (change to "base" for mainnet).
		const network = "base-sepolia"

		netConfig, ok := x402Handlers.NetworkConfigs[network]
		if !ok {
			return c.Status(400).JSON(fiber.Map{"error": "unsupported network"})
		}

		wallet, err := dbengine.GetWalletByNetwork(c.Context(), pool, dbengine.Network(network))
		if err != nil {
			log.Printf("get wallet by network: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "no wallet available for this network"})
		}

		return c.Status(200).JSON(fiber.Map{
			"x402Version": 2,
			"accepts": []x402Handlers.PaymentRequirements{
				{
					Scheme:            "exact",
					Network:           netConfig.CAIP2,
					MaxAmountRequired: strconv.FormatInt(amountMicro, 10),
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

// payloadEnvelope is used to extract the to address and value from the
// EIP-712 signed payload without deserializing the entire structure.
type payloadEnvelope struct {
	Payload struct {
		Authorization struct {
			To    string      `json:"to"`
			Value json.Number `json:"value"`
		} `json:"authorization"`
	} `json:"payload"`
}

// SettlePayment handles POST /v1/settle-payment.
// Extracts the recipient wallet and amount from the signed payload,
// verifies and settles via the facilitator, then writes the ledger.
func SettlePayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		merchant := c.Locals("merchant_api_key").(*dbengine.Merchant)

		var req struct {
			PaymentPayload string `json:"payment_payload"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		// Decode base64 payment payload.
		payloadBytes, err := base64.StdEncoding.DecodeString(req.PaymentPayload)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment_payload encoding"})
		}
		if !json.Valid(payloadBytes) {
			return c.Status(400).JSON(fiber.Map{"error": "invalid payment_payload JSON"})
		}

		// Extract to address and value from the signed EIP-712 payload.
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

		// Look up the wallet by the signed to address — verify it's ours.
		wallet, err := dbengine.GetWalletByAddress(c.Context(), pool, toAddress)
		if err != nil {
			log.Printf("get wallet by address: %v", err)
			return c.Status(400).JSON(fiber.Map{"error": "recipient address not recognized"})
		}

		netConfig, ok := x402Handlers.NetworkConfigs[string(wallet.Network)]
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "network config not found for wallet"})
		}

		// Build canonical requirements from trusted data (wallet + signed value).
		canonicalRequirements := x402Handlers.PaymentRequirements{
			Scheme:            "exact",
			Network:           netConfig.CAIP2,
			MaxAmountRequired: valueStr,
			Asset:             netConfig.USDCAddress,
			PayTo:             wallet.Address,
			MaxTimeoutSeconds: maxTimeoutSeconds,
			Extra: map[string]any{
				"name":                "USDC",
				"version":             "1",
				"assetTransferMethod": "eip3009",
			},
		}

		payload := json.RawMessage(payloadBytes)

		// Call facilitator /verify.
		verifyResp, err := x402Handlers.Verify(c.Context(), payload, canonicalRequirements)
		if err != nil {
			log.Printf("facilitator verify error: %v", err)
			return c.Status(502).JSON(fiber.Map{
				"success":       false,
				"error_reason":  "verify_failed",
				"error_message": "facilitator verification failed",
			})
		}
		if !verifyResp.IsValid {
			return c.Status(400).JSON(fiber.Map{
				"success":       false,
				"error_reason":  verifyResp.InvalidReason,
				"error_message": verifyResp.InvalidMessage,
			})
		}

		// Call facilitator /settle.
		settleResp, err := x402Handlers.Settle(c.Context(), payload, canonicalRequirements)
		if err != nil {
			log.Printf("facilitator settle error: %v", err)
			return c.Status(502).JSON(fiber.Map{
				"success":       false,
				"error_reason":  "settle_failed",
				"error_message": "facilitator settlement failed",
			})
		}
		if !settleResp.Success {
			return c.Status(400).JSON(fiber.Map{
				"success":       false,
				"error_reason":  settleResp.ErrorReason,
				"error_message": settleResp.ErrorMessage,
			})
		}

		// Write double-entry ledger using the tx hash as idempotency key.
		merchantAcct, err := dbengine.GetMerchantUSDCLiabilityAccount(c.Context(), pool, merchant.ID)
		if err != nil {
			log.Printf("get merchant liability account: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to look up merchant account"})
		}

		_, err = dbengine.InsertTransaction(c.Context(), pool, settleResp.Transaction, []dbengine.LedgerLine{
			{Currency: dbengine.USDC, Amount: amount, Direction: dbengine.Debit, AccountID: wallet.AccountID},
			{Currency: dbengine.USDC, Amount: amount, Direction: dbengine.Credit, AccountID: merchantAcct.ID},
		})
		if err != nil {
			log.Printf("insert ledger transaction: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to create ledger entry"})
		}

		return c.Status(200).JSON(fiber.Map{
			"success":     true,
			"transaction": settleResp.Transaction,
			"network":     string(wallet.Network),
			"payer":       settleResp.Payer,
		})
	}
}
