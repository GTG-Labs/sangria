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
	"strings"
	"sync"
	"time"

	cdpauth "github.com/coinbase/cdp-sdk/go/auth"

	"sangria/backend/config"
)

// ─── Configuration ──────────────────────────────────────────────────────────

var httpClient = &http.Client{Timeout: 30 * time.Second}

const maxFacilitatorBody = 1 << 20 // 1 MB — caps response reads to prevent OOM
const maxRetries = 1               // one additional attempt after the first failure
const retryDelay = 2 * time.Second

// FacilitatorURL returns the configured facilitator base URL (e.g.
// "https://api.cdp.coinbase.com/platform/v2/x402"). Validated at startup
// via config.LoadX402Config — the process exits if unset.
func FacilitatorURL() string {
	return config.X402.FacilitatorURL
}

// ─── Facilitator Discovery ──────────────────────────────────────────────────
//
// The CDP facilitator exposes GET /supported which lists every scheme+network
// it can settle. For the "upto" (Permit2) scheme, each entry includes the
// on-chain address the facilitator will use to execute the transfer. Clients
// must embed this address in the Permit2 witness when signing — so we fetch
// it once at startup and serve it in generate-payment responses.
//
// Exact (EIP-3009) doesn't need a facilitator address in the witness, so we
// only cache entries for upto.
//
// Example /supported response entry for upto:
//
//	{
//	  "network": "eip155:8453",
//	  "scheme": "upto",
//	  "x402Version": 2,
//	  "extra": { "facilitatorAddress": "0x8F5cB67B49555E614892b7233CFdDEBFB746E531" }
//	}

var (
	facilitatorAddresses   map[string]string // CAIP-2 network → on-chain address
	facilitatorAddressesMu sync.RWMutex
)

// supportedResponse is the shape returned by GET /supported on the facilitator.
type supportedResponse struct {
	Kinds []struct {
		Network     string         `json:"network"`
		Scheme      string         `json:"scheme"`
		X402Version int            `json:"x402Version"`
		Extra       map[string]any `json:"extra,omitempty"`
	} `json:"kinds"`
}

// FetchFacilitatorAddresses calls GET /supported on the configured facilitator,
// extracts the on-chain address for each upto-capable network, and caches the
// result. Called once at startup. Non-fatal if it fails — upto simply won't
// work until the server is restarted with a reachable facilitator.
func FetchFacilitatorAddresses(ctx context.Context) error {
	facilitatorURL := FacilitatorURL()
	url := facilitatorURL + "/supported"
	authPath := "/platform/v2/x402/supported"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("create /supported request: %w", err)
	}
	if err := addCDPAuth(req, facilitatorURL, authPath); err != nil {
		return fmt.Errorf("auth for /supported: %w", err)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("fetch /supported: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxFacilitatorBody))
	if err != nil {
		return fmt.Errorf("read /supported response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("/supported returned status %d: %s", resp.StatusCode, string(body))
	}

	var supported supportedResponse
	if err := json.Unmarshal(body, &supported); err != nil {
		return fmt.Errorf("unmarshal /supported: %w", err)
	}

	addrs := make(map[string]string)
	for _, kind := range supported.Kinds {
		if kind.Scheme != "upto" || kind.X402Version != 2 {
			continue
		}
		addr, _ := kind.Extra["facilitatorAddress"].(string)
		if addr == "" {
			continue
		}
		addrs[kind.Network] = addr
		slog.Info("cached upto facilitator address", "network", kind.Network, "address", addr)
	}

	facilitatorAddressesMu.Lock()
	facilitatorAddresses = addrs
	facilitatorAddressesMu.Unlock()

	return nil
}

// UptoFacilitatorAddress returns the cached on-chain facilitator address for
// the given CAIP-2 network. Returns "" if upto isn't supported on that network
// or FetchFacilitatorAddresses hasn't been called yet.
func UptoFacilitatorAddress(caip2Network string) string {
	facilitatorAddressesMu.RLock()
	defer facilitatorAddressesMu.RUnlock()
	return facilitatorAddresses[caip2Network]
}

// ─── CDP Authentication ─────────────────────────────────────────────────────

// addCDPAuth adds a CDP JWT Authorization header to the request if the
// facilitator URL is the Coinbase CDP API (which requires auth).
// The testnet facilitator at x402.org does not need auth.
func addCDPAuth(req *http.Request, facilitatorURL, path string) error {
	if !strings.Contains(facilitatorURL, "api.cdp.coinbase.com") {
		return nil
	}

	token, err := cdpauth.GenerateJWT(cdpauth.JwtOptions{
		KeyID:         config.CDP.APIKey,
		KeySecret:     config.CDP.APISecret,
		RequestMethod: req.Method,
		RequestHost:   "api.cdp.coinbase.com",
		RequestPath:   path,
	})
	if err != nil {
		return fmt.Errorf("generate CDP JWT: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	return nil
}

// ─── HTTP Transport ─────────────────────────────────────────────────────────

// isRetryable returns true for transient failures worth retrying
// (network errors, timeouts, 5xx). 4xx = bad payload, not retryable.
func isRetryable(err error, statusCode int) bool {
	if err != nil {
		return true
	}
	return statusCode >= 500
}

// doFacilitatorRequestOnce makes a single HTTP attempt. Used directly by
// Settle (which must NOT retry — see root CLAUDE.md) and as the underlying
// transport for doFacilitatorRequestIdempotent.
func doFacilitatorRequestOnce(ctx context.Context, method, url, authPath, facilitatorURL string, body []byte) ([]byte, int, error) {
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
		return nil, 0, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxFacilitatorBody))
	if err != nil {
		return nil, 0, fmt.Errorf("read response: %w", err)
	}

	return respBody, resp.StatusCode, nil
}

// doFacilitatorRequestIdempotent retries once on transient failures.
// ONLY for idempotent endpoints like /verify. Never use for /settle.
func doFacilitatorRequestIdempotent(ctx context.Context, method, url, authPath, facilitatorURL string, body []byte) ([]byte, int, error) {
	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			slog.Info("retrying facilitator request", "url", url, "attempt", attempt+1)
			time.Sleep(retryDelay)
		}

		respBody, statusCode, err := doFacilitatorRequestOnce(ctx, method, url, authPath, facilitatorURL, body)
		if err != nil {
			lastErr = err
			if isRetryable(err, 0) {
				continue
			}
			return nil, 0, lastErr
		}

		if isRetryable(nil, statusCode) {
			slog.Debug("facilitator returned retryable status", "status", statusCode, "body", string(respBody))
			lastErr = fmt.Errorf("returned status %d", statusCode)
			continue
		}

		return respBody, statusCode, nil
	}

	return nil, 0, fmt.Errorf("all attempts failed: %w", lastErr)
}

// ─── Request Body Builder ───────────────────────────────────────────────────

// removeNulls recursively strips nil values from maps so the CDP strict
// schema validator doesn't reject them as invalid object types.
func removeNulls(m map[string]interface{}) {
	for k, v := range m {
		if v == nil {
			delete(m, k)
		} else if nested, ok := v.(map[string]interface{}); ok {
			removeNulls(nested)
		}
	}
}

// buildFacilitatorRequestBody builds the JSON body that the CDP facilitator
// expects for /verify and /settle.
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

// ─── Verify & Settle ────────────────────────────────────────────────────────

// Verify calls the facilitator /verify endpoint to validate a payment
// authorization (EIP-712 signature, balance, nonce, etc.).
func Verify(ctx context.Context, payload json.RawMessage, requirements PaymentRequirements) (*VerifyResponse, error) {
	facilitatorURL := FacilitatorURL()

	body, err := buildFacilitatorRequestBody(payload, requirements)
	if err != nil {
		return nil, fmt.Errorf("build verify request: %w", err)
	}

	slog.Info("facilitator verify request", "url", facilitatorURL+"/verify", "body", string(body))

	respBody, statusCode, err := doFacilitatorRequestIdempotent(
		ctx, http.MethodPost, facilitatorURL+"/verify",
		"/platform/v2/x402/verify", facilitatorURL, body,
	)
	if err != nil {
		return nil, fmt.Errorf("facilitator verify: %w", err)
	}

	slog.Info("facilitator verify response", "status", statusCode, "body", string(respBody))

	if statusCode != http.StatusOK {
		return nil, fmt.Errorf("facilitator verify returned status %d", statusCode)
	}

	var result VerifyResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unmarshal verify response: %w", err)
	}

	return &result, nil
}

// Settle calls the facilitator /settle endpoint to submit the on-chain
// transfer (EIP-3009 for exact, Permit2 for upto).
func Settle(ctx context.Context, payload json.RawMessage, requirements PaymentRequirements) (*SettleResponse, error) {
	facilitatorURL := FacilitatorURL()

	body, err := buildFacilitatorRequestBody(payload, requirements)
	if err != nil {
		return nil, fmt.Errorf("build settle request: %w", err)
	}

	slog.Info("facilitator settle request", "url", facilitatorURL+"/settle", "body", string(body))

	// Settle uses doFacilitatorRequestOnce (no retries) because x402 settle
	// is NOT HTTP-idempotent — see root CLAUDE.md.
	respBody, statusCode, err := doFacilitatorRequestOnce(
		ctx, http.MethodPost, facilitatorURL+"/settle",
		"/platform/v2/x402/settle", facilitatorURL, body,
	)
	if err != nil {
		return nil, fmt.Errorf("facilitator settle: %w", err)
	}

	slog.Info("facilitator settle response", "status", statusCode, "body", string(respBody))

	if statusCode != http.StatusOK {
		return nil, fmt.Errorf("facilitator settle returned status %d", statusCode)
	}

	var result SettleResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unmarshal settle response: %w", err)
	}

	return &result, nil
}
