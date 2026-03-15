package x402

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// TODO: Become our own facilitator — handle EIP-712 signature verification
// and on-chain EIP-3009 transferWithAuthorization submission directly on
// this server. Eliminates the external HTTP round-trip to the facilitator,
// which should be significantly faster.
var httpClient = &http.Client{Timeout: 30 * time.Second}

// FacilitatorURL returns the configured facilitator URL from the
// X402_FACILITATOR_URL environment variable.
func FacilitatorURL() string {
	return os.Getenv("X402_FACILITATOR_URL")
}

// Verify calls the facilitator /verify endpoint to validate a payment
// authorization (EIP-712 signature, balance, nonce, etc.).
func Verify(ctx context.Context, payload map[string]any, requirements PaymentRequirements) (*VerifyResponse, error) {
	reqBody := VerifyRequest{
		X402Version:  1,
		Payload:      payload,
		Requirements: requirements,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal verify request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, FacilitatorURL()+"/verify", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create verify request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("facilitator verify: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
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
func Settle(ctx context.Context, payload map[string]any, requirements PaymentRequirements) (*SettleResponse, error) {
	reqBody := SettleRequest{
		X402Version:  1,
		Payload:      payload,
		Requirements: requirements,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal settle request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, FacilitatorURL()+"/settle", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create settle request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("facilitator settle: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
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
