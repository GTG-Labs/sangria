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
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	cdpauth "github.com/coinbase/cdp-sdk/go/auth"
)

var httpClient = &http.Client{Timeout: 30 * time.Second}

// maxFacilitatorBody caps the size of facilitator responses to prevent OOM.
const maxFacilitatorBody = 1 << 20 // 1 MB

// maxRetries is the number of additional attempts after the first failure
// for transient HTTP errors (timeouts, connection refused, 5xx).
const maxRetries = 1

// retryDelay is the wait time between retry attempts.
const retryDelay = 2 * time.Second

// isRetryable returns true if the error or HTTP status code indicates a
// transient failure that may succeed on retry.
func isRetryable(err error, statusCode int) bool {
	if err != nil {
		// Timeout, connection refused, DNS failure, etc.
		return true
	}
	// 5xx = server error on facilitator side, worth retrying.
	// 4xx = client error (bad payload), not retryable.
	return statusCode >= 500
}

// doFacilitatorRequest executes an HTTP request against the facilitator with
// a single retry on transient failures. Returns the response body and status
// code on success, or an error if all attempts fail.
func doFacilitatorRequest(ctx context.Context, method, url, authPath, facilitatorURL string, body []byte) ([]byte, int, error) {
	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			slog.Info("retrying facilitator request", "url", url, "attempt", attempt+1)
			time.Sleep(retryDelay)
		}

		req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
		if err != nil {
			return nil, 0, fmt.Errorf("create request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")

		if err := addCDPAuth(req, facilitatorURL, authPath); err != nil {
			return nil, 0, fmt.Errorf("facilitator auth: %w", err)
		}

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("http request: %w", err)
			if isRetryable(err, 0) {
				continue
			}
			return nil, 0, lastErr
		}

		respBody, readErr := io.ReadAll(io.LimitReader(resp.Body, maxFacilitatorBody))
		resp.Body.Close()
		if readErr != nil {
			lastErr = fmt.Errorf("read response: %w", readErr)
			continue
		}

		if isRetryable(nil, resp.StatusCode) {
			slog.Debug("facilitator returned retryable status", "status", resp.StatusCode, "body", string(respBody))
			lastErr = fmt.Errorf("returned status %d", resp.StatusCode)
			continue
		}

		return respBody, resp.StatusCode, nil
	}

	return nil, 0, fmt.Errorf("all attempts failed: %w", lastErr)
}

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
	apiKeySecret := os.Getenv("CDP_API_SECRET")
	if apiKeyID == "" || apiKeySecret == "" {
		return fmt.Errorf("CDP_API_KEY and CDP_API_SECRET are required for Coinbase facilitator")
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

	slog.Debug("calling facilitator verify", "url", facilitatorURL)

	respBody, statusCode, err := doFacilitatorRequest(
		ctx, http.MethodPost, facilitatorURL+"/verify",
		"/platform/v2/x402/verify", facilitatorURL, body,
	)
	if err != nil {
		return nil, fmt.Errorf("facilitator verify: %w", err)
	}

	if statusCode != http.StatusOK {
		slog.Debug("facilitator verify non-200 response", "status", statusCode, "body", string(respBody))
		return nil, fmt.Errorf("facilitator verify returned status %d", statusCode)
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

	respBody, statusCode, err := doFacilitatorRequest(
		ctx, http.MethodPost, facilitatorURL+"/settle",
		"/platform/v2/x402/settle", facilitatorURL, body,
	)
	if err != nil {
		return nil, fmt.Errorf("facilitator settle: %w", err)
	}
	if statusCode != http.StatusOK {
		slog.Debug("facilitator settle non-200 response", "status", statusCode, "body", string(respBody))
		return nil, fmt.Errorf("facilitator settle returned status %d", statusCode)
	}

	var result SettleResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unmarshal settle response: %w", err)
	}

	return &result, nil
}
