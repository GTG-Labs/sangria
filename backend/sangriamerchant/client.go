// Package sangriamerchant is a thin HTTP client for talking to merchant
// proxies that speak the Sangria-native protocol.
//
// Two operations only:
//
//   - FetchCatalog: GET the merchant's catalog endpoint and parse the
//     CatalogResponse (store metadata, buy endpoint declaration, products).
//   - Buy: POST a BuyRequest to the merchant's /buy endpoint and parse
//     the BuyResult.
//
// The client is stateless except for the underlying http.Client. The same
// instance serves any merchant URL — V1 has exactly one merchant configured
// via MERCHANT_CATALOG_URL, but the API is shaped so multi-merchant V1.x
// doesn't need to refactor the client.
//
// Per-call timeout budgets (10s catalog, 30s buy) are the caller's
// responsibility via context.WithTimeout — the http.Client has a 60s
// backstop for misconfigured callers. No retries: a Buy failure is treated
// as a merchant failure by the handler (it calls FailAgentPayment +
// FailOrder); retrying at HTTP would risk double-charging on ambiguous
// responses, same reasoning as the facilitator-Settle rule in root CLAUDE.md.
//
// Wire-format types (PriceUSD as float64, addresses in Stripe shape) are
// faithful to what the merchant proxy actually sends; decimal-to-microunits
// conversion and any other coercion lives in the buyHandlers callers, not
// here.
package sangriamerchant

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Catalog types (GET response shape)
// ---------------------------------------------------------------------------

// CatalogResponse is the body the merchant returns from a GET on its catalog
// endpoint. Carries store-level metadata + the buy-endpoint declaration +
// the product list to score against.
type CatalogResponse struct {
	Store       Store     `json:"store"`
	BuyEndpoint BuyEndpoint `json:"buyEndpoint"`
	Products    []Product `json:"products"`
}

// Store carries the merchant's identity, currency, service area, and
// delivery config. ServiceArea is a slice of "US-<state>" codes; an
// operator whose shipping state isn't in this list can't be served by
// this merchant.
type Store struct {
	ID          string         `json:"id"`          // e.g. "starbucks-by-nespresso" (merchant-owned slug)
	Name        string         `json:"name"`        // display name
	Currency    string         `json:"currency"`    // "USD" in V1
	ServiceArea []string       `json:"serviceArea"` // e.g. ["US-CA"]
	Delivery    DeliveryConfig `json:"delivery"`
}

// DeliveryConfig is the merchant's delivery surcharge declaration. V1 only
// supports flat fees; the Type field is informational and not interpreted.
type DeliveryConfig struct {
	Fee      float64 `json:"fee"`      // decimal USD; converted to microunits at the handler boundary
	Currency string  `json:"currency"` // currency code
	Type     string  `json:"type"`     // e.g. "flat"
}

// BuyEndpoint declares where + how to POST a buy request. Auth selects which
// authentication flow to run; V1 supports "sangria" only (caller rejects
// anything else with 501 unsupported_auth).
type BuyEndpoint struct {
	Method string `json:"method"` // "POST"
	Path   string `json:"path"`   // e.g. "/buy"
	Auth   string `json:"auth"`   // "sangria" in V1; "x402" deferred
}

// Product is one item the merchant sells. PriceUSD is the decimal price
// without delivery; total cost = PriceUSD + Store.Delivery.Fee. Display
// fields (ImageURL, Rating, etc.) are passed through to the agent in the
// /v1/buy response but not persisted on the order.
type Product struct {
	SKU        string  `json:"sku"`
	Name       string  `json:"name"`
	PriceUSD   float64 `json:"priceUsd"`
	Rating     float64 `json:"rating"`
	NumReviews int     `json:"numReviews"`
	ImageURL   string  `json:"imageUrl"`
	ProductURL string  `json:"productUrl"`
	Category   string  `json:"category"` // slash-delimited path, e.g. "grocery-and-gourmet-food/beverages/coffee"
}

// ---------------------------------------------------------------------------
// Buy types (POST request + response shape)
// ---------------------------------------------------------------------------

// BuyRequest is the body Sangria POSTs to the merchant's /buy endpoint on
// /v1/buy/{order_id}/confirm. Forwarded verbatim from the operator's
// stored profile fields.
type BuyRequest struct {
	Items   []BuyItem  `json:"items"`
	Email   string     `json:"email"`
	Phone   string     `json:"phone"`
	Address BuyAddress `json:"address"`
}

// BuyItem is one line of a buy request. V1 always sets Quantity=1; multi-unit
// orders require NLP on the agent's description and aren't supported yet.
type BuyItem struct {
	SKU      string `json:"sku"`
	Quantity int    `json:"quantity"`
}

// BuyAddress matches the Stripe Address shape used in
// agent_operators.address.shipping. No translation layer; we forward storage
// straight through.
type BuyAddress struct {
	Line1      string `json:"line1"`
	Line2      string `json:"line2,omitempty"`
	City       string `json:"city"`
	State      string `json:"state"`
	PostalCode string `json:"postal_code"`
	Country    string `json:"country"`
}

// BuyResult is the merchant's response. Status is the canonical signal —
// "completed" / "running" / "failed". The handler branches on it; this
// package never interprets it. Result is the merchant's opaque payload
// (receipt, tracking number, etc.) present when status="completed".
type BuyResult struct {
	MerchantOrderID string          `json:"merchant_order_id"`
	Status          string          `json:"status"`
	Result          json.RawMessage `json:"result"`
	Error           *BuyError       `json:"error,omitempty"`
}

// BuyError carries the merchant's failure reason when Status="failed".
// Both fields are merchant-supplied free-form strings; handler maps to
// Sangria's failure_code / failure_message fields on the order row.
type BuyError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Canonical status values returned by the merchant. Constants here keep
// string-matching at call sites typo-proof.
const (
	BuyResultStatusCompleted = "completed"
	BuyResultStatusRunning   = "running"
	BuyResultStatusFailed    = "failed"
)

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

// Client wraps an *http.Client. Stateless beyond the connection pool — same
// instance serves any merchant URL passed to FetchCatalog / Buy.
type Client struct {
	httpClient *http.Client
}

// New constructs a Client with a 60s backstop timeout on the underlying
// http.Client. Per-call budgets are the caller's responsibility via
// context.WithTimeout (10s for catalog, 30s for buy per the plan).
func New() *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// FetchCatalog GETs the given catalog URL and parses the response. Returns
// a descriptive error on network failure, non-2xx response, or malformed
// JSON. The caller is responsible for wrapping the context in a 10s
// timeout (see § Architecture overview in BUY_ENDPOINT_PLAN.md).
func (c *Client) FetchCatalog(ctx context.Context, catalogURL string) (CatalogResponse, error) {
	if strings.TrimSpace(catalogURL) == "" {
		return CatalogResponse{}, fmt.Errorf("catalog URL must not be empty")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, catalogURL, nil)
	if err != nil {
		return CatalogResponse{}, fmt.Errorf("build catalog request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return CatalogResponse{}, fmt.Errorf("fetch catalog %s: %w", catalogURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return CatalogResponse{}, fmt.Errorf("fetch catalog %s: unexpected status %d", catalogURL, resp.StatusCode)
	}

	var out CatalogResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return CatalogResponse{}, fmt.Errorf("decode catalog response from %s: %w", catalogURL, err)
	}
	return out, nil
}

// Buy POSTs the assembled BuyRequest to the merchant's /buy URL and parses
// the BuyResult. Returns a descriptive error on network failure, non-2xx
// response, or malformed JSON. Does NOT interpret BuyResult.Status — the
// handler branches on it (completed / running / failed). Caller wraps the
// context in a 30s timeout.
func (c *Client) Buy(ctx context.Context, buyURL string, body BuyRequest) (BuyResult, error) {
	if strings.TrimSpace(buyURL) == "" {
		return BuyResult{}, fmt.Errorf("buy URL must not be empty")
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return BuyResult{}, fmt.Errorf("marshal buy request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, buyURL, bytes.NewReader(payload))
	if err != nil {
		return BuyResult{}, fmt.Errorf("build buy request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return BuyResult{}, fmt.Errorf("post buy %s: %w", buyURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return BuyResult{}, fmt.Errorf("post buy %s: unexpected status %d", buyURL, resp.StatusCode)
	}

	var out BuyResult
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return BuyResult{}, fmt.Errorf("decode buy response from %s: %w", buyURL, err)
	}
	return out, nil
}

// DeriveBuyURL composes the merchant's /buy URL from the catalog URL and
// the BuyEndpoint.Path declared in the catalog response. Joining URLs by
// hand is easy to get subtly wrong (trailing slashes, query strings,
// absolute-vs-relative paths) — this helper centralizes the rules so every
// caller gets them right.
//
// Behavior:
//   - If buyEndpoint.Path is an absolute URL ("http://..." or "https://..."),
//     return it verbatim (some merchants might host their buy endpoint on
//     a different host than their catalog).
//   - Otherwise, resolve buyEndpoint.Path against catalogURL using the
//     standard URL-resolution rules (net/url's ResolveReference). An
//     absolute path replaces the catalog's path; a relative path is joined
//     onto the catalog URL's directory.
func DeriveBuyURL(catalogURL string, buyEndpoint BuyEndpoint) (string, error) {
	if strings.TrimSpace(catalogURL) == "" {
		return "", fmt.Errorf("catalog URL must not be empty")
	}
	if strings.TrimSpace(buyEndpoint.Path) == "" {
		return "", fmt.Errorf("buyEndpoint.Path must not be empty")
	}

	base, err := url.Parse(catalogURL)
	if err != nil {
		return "", fmt.Errorf("parse catalog URL %q: %w", catalogURL, err)
	}
	if base.Scheme != "http" && base.Scheme != "https" {
		return "", fmt.Errorf("catalog URL %q has unsupported scheme %q", catalogURL, base.Scheme)
	}

	ref, err := url.Parse(buyEndpoint.Path)
	if err != nil {
		return "", fmt.Errorf("parse buyEndpoint.Path %q: %w", buyEndpoint.Path, err)
	}
	// Absolute URL — return as-is (caller's merchant may host the buy
	// endpoint on a different host).
	if ref.IsAbs() {
		return ref.String(), nil
	}

	// Relative path. ResolveReference treats catalog URL's path component
	// as the "current directory" — a leading slash on Path means absolute
	// path (replace catalog path); no leading slash joins relative to
	// catalog URL's directory.
	if !strings.HasPrefix(ref.Path, "/") {
		// Defensive: make sure the catalog URL's path ends in something
		// that ResolveReference treats as a directory. dirname() the path
		// component if it doesn't already end in "/".
		base = withDirPath(base)
	}
	return base.ResolveReference(ref).String(), nil
}

// withDirPath returns a copy of u whose path has had its filename
// component stripped (so ResolveReference treats it as a directory).
// Example: "http://m/api/catalog" → "http://m/api/" ; "http://m/" → "http://m/".
func withDirPath(u *url.URL) *url.URL {
	clone := *u
	if clone.Path == "" {
		return &clone
	}
	dir := path.Dir(clone.Path)
	if !strings.HasSuffix(dir, "/") {
		dir += "/"
	}
	clone.Path = dir
	return &clone
}
