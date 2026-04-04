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
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	cdpauth "github.com/coinbase/cdp-sdk/go/auth"
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

// addCDPAuth adds a CDP JWT Authorization header to the request if the
// facilitator URL is the Coinbase CDP API (which requires auth).
// The testnet facilitator at x402.org does not need auth.
func addCDPAuth(req *http.Request, facilitatorURL, path string) error {
	if !strings.Contains(facilitatorURL, "api.cdp.coinbase.com") {
		return nil
	}

	apiKeyID := os.Getenv("CDP_API_KEY")
	apiKeySecret := os.Getenv("CDP_SECRET_KEY")
	if apiKeyID == "" || apiKeySecret == "" {
		return fmt.Errorf("CDP_API_KEY and CDP_SECRET_KEY are required for Coinbase facilitator")
	}

	token, err := cdpauth.GenerateJWT(cdpauth.JwtOptions{
		KeyID:         apiKeyID,
		KeySecret:     apiKeySecret,
		RequestMethod: "POST",
		RequestHost:   "api.cdp.coinbase.com",
		RequestPath:   path,
	})
	if err != nil {
		return fmt.Errorf("generate CDP JWT: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	return nil
}

// removeNulls recursively strips nil/null values from maps so the CDP
// strict schema validator doesn't reject them as invalid object types.
func removeNulls(m map[string]interface{}) {
	for k, v := range m {
		if v == nil {
			delete(m, k)
		} else if nested, ok := v.(map[string]interface{}); ok {
			removeNulls(nested)
		}
	}
}

// buildFacilitatorRequestBody builds the request body matching the format the
// CDP facilitator API expects per:
// https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/verify-a-payment
func buildFacilitatorRequestBody(payload json.RawMessage, requirements PaymentRequirements) ([]byte, error) {
	var payloadMap map[string]interface{}
	if err := json.Unmarshal(payload, &payloadMap); err != nil {
		return nil, fmt.Errorf("unmarshal payload: %w", err)
	}
	removeNulls(payloadMap)

	requirementsBytes, err := json.Marshal(requirements)
	if err != nil {
		return nil, fmt.Errorf("marshal requirements: %w", err)
	}
	var requirementsMap map[string]interface{}
	if err := json.Unmarshal(requirementsBytes, &requirementsMap); err != nil {
		return nil, fmt.Errorf("unmarshal requirements: %w", err)
	}

	requestBody := map[string]interface{}{
		"x402Version":         2,
		"paymentPayload":      payloadMap,
		"paymentRequirements": requirementsMap,
	}

	return json.Marshal(requestBody)
}

// Verify calls the facilitator /verify endpoint to validate a payment
// authorization (EIP-712 signature, balance, nonce, etc.).
func Verify(ctx context.Context, payload json.RawMessage, requirements PaymentRequirements) (*VerifyResponse, error) {
	facilitatorURL, err := FacilitatorURL()
	if err != nil {
		return nil, err
	}

	body, err := buildFacilitatorRequestBody(payload, requirements)
	if err != nil {
		return nil, fmt.Errorf("build verify request: %w", err)
	}

	log.Printf("facilitator verify request body: %s", string(body))

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, facilitatorURL+"/verify", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create verify request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	if err := addCDPAuth(req, facilitatorURL, "/platform/v2/x402/verify"); err != nil {
		return nil, fmt.Errorf("facilitator auth: %w", err)
	}

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

	body, err := buildFacilitatorRequestBody(payload, requirements)
	if err != nil {
		return nil, fmt.Errorf("build settle request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, facilitatorURL+"/settle", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create settle request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	if err := addCDPAuth(req, facilitatorURL, "/platform/v2/x402/settle"); err != nil {
		return nil, fmt.Errorf("facilitator auth: %w", err)
	}

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
