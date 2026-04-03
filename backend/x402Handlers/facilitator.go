// TODO: Become our own facilitator — handle EIP-712 signature verification
// and on-chain EIP-3009 transferWithAuthorization submission directly on
// this server. Eliminates the external HTTP round-trip to the facilitator,
// which should be significantly faster.
package x402Handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
)

var httpClient = &http.Client{Timeout: 30 * time.Second}

// maxFacilitatorBody caps the size of facilitator responses to prevent OOM.
const maxFacilitatorBody = 1 << 20 // 1 MB

// FacilitatorURL returns the configured facilitator URL from the
// X402_FACILITATOR_URL environment variable. Returns an error if unset.
func FacilitatorURL() (string, error) {
	url := os.Getenv("X402_FACILITATOR_URL")
	if url == "" {
		return "", fmt.Errorf("X402_FACILITATOR_URL environment variable is not set")
	}
	return url, nil
}

// Verify calls the facilitator /verify endpoint to validate a payment
// authorization (EIP-712 signature, balance, nonce, etc.).
func Verify(ctx context.Context, payload json.RawMessage, requirements PaymentRequirements) (*VerifyResponse, error) {
	facilitatorURL, err := FacilitatorURL()
	if err != nil {
		return nil, err
	}

	reqBody := VerifyRequest{
		X402Version:  2,
		Payload:      payload,
		Requirements: requirements,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal verify request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, facilitatorURL+"/verify", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create verify request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("facilitator verify: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxFacilitatorBody))
	if err != nil {
		return nil, fmt.Errorf("read verify response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("facilitator verify returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result VerifyResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unmarshal verify response: %w", err)
	}

	return &result, nil
}

// Settle calls the facilitator /settle endpoint to submit the
// transferWithAuthorization (EIP-3009) on-chain and move USDC.
func Settle(ctx context.Context, payload json.RawMessage, requirements PaymentRequirements) (*SettleResponse, error) {
	facilitatorURL, err := FacilitatorURL()
	if err != nil {
		return nil, err
	}

	reqBody := SettleRequest{
		X402Version:  2,
		Payload:      payload,
		Requirements: requirements,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal settle request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, facilitatorURL+"/settle", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create settle request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("facilitator settle: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxFacilitatorBody))
	if err != nil {
		return nil, fmt.Errorf("read settle response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("facilitator settle returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result SettleResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unmarshal settle response: %w", err)
	}

	return &result, nil
}

// VerifyPayment handles POST /facilitator/verify
func VerifyPayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		type VerifyPaymentRequest struct {
			PaymentHeader string                 `json:"payment_header"`
			Requirements  map[string]interface{} `json:"requirements"`
		}

		var req VerifyPaymentRequest
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		// Payment verification logic not yet implemented
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
			"error": "Payment verification functionality not yet implemented",
			"code":  "NOT_IMPLEMENTED",
		})
	}
}

// SettlePayment handles POST /facilitator/settle
func SettlePayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		type SettlePaymentRequest struct {
			PaymentHeader string                 `json:"payment_header"`
			Requirements  map[string]interface{} `json:"requirements"`
		}

		var req SettlePaymentRequest
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		// Payment settlement logic not yet implemented
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
			"error": "Payment settlement functionality not yet implemented",
			"code":  "NOT_IMPLEMENTED",
		})
	}
}
