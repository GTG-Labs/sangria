// Package buyHandlers implements the four /v1/buy endpoints — Sangria's
// discovery + checkout surface for agent API keys. See
// agent-sdk-planning/BUY_ENDPOINT_PLAN.md for the full design.
//
// Files in this package:
//
//	common.go   — module-level merchant client + shared helpers + response types
//	buy.go      — POST /v1/buy            (mint up to 3 quotes against the merchant)
//	confirm.go  — POST /v1/buy/{id}/confirm (charge the operator + call merchant)
//	cancel.go   — POST /v1/buy/{id}/cancel  (abandon an unconfirmed quote)
//	status.go   — GET  /v1/buy/{id}         (poll order state)
package buyHandlers

import (
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/gofiber/fiber/v3"

	dbengine "sangria/backend/dbEngine"
	"sangria/backend/sangriamerchant"
)

// Per-call timeout budgets for outgoing merchant HTTP calls. The merchant
// client has a 60s backstop on its http.Client; these tighter budgets are
// enforced via context.WithTimeout at each call site so the handler can
// FailAgentPayment / FailOrder and return a real response before the agent
// gives up. See BUY_ENDPOINT_PLAN.md fix #6.
const (
	catalogTimeout = 10 * time.Second
	buyTimeout     = 30 * time.Second
)

// quoteTTL is how long a /v1/buy quote stays valid for /confirm. Matches
// the SANGRIA_BUY_SKILL.md guidance. Hardcoded for V1; promote to env var
// only if tuning becomes a need.
const quoteTTL = 60 * time.Second

// merchantClient is the package-level merchant HTTP client. Constructed
// once at package init; stateless except for the underlying http.Client's
// connection pool, so a single instance serves every handler call. If we
// ever add tests, expose SetClient.
var merchantClient = sangriamerchant.New()

// ---------------------------------------------------------------------------
// Microunits conversion
// ---------------------------------------------------------------------------

// toMicrounits converts a decimal-USD amount (as the merchant sends it on
// the wire) to int64 microunits ($1 = 1_000_000). Uses math.Round to avoid
// float-drift edge cases on prices like 28.5 → 28_500_000 vs 28_499_999.
func toMicrounits(usd float64) int64 {
	return int64(math.Round(usd * 1_000_000))
}

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

// errorJSON returns the canonical single-field error envelope used across
// the merchant + agent APIs. Same shape as merchantHandlers — handler code
// branches on the `error` value, not on HTTP status alone.
func errorJSON(code string) fiber.Map {
	return fiber.Map{"error": code}
}

// errorJSONWithField returns an error envelope with a structured sub-reason
// pointing to the offending field. Used by missing_operator_profile so the
// agent can tell which field needs to be set (and by service_area_mismatch
// to surface the operator state vs merchant service area mismatch).
func errorJSONWithField(code, field string) fiber.Map {
	return fiber.Map{"error": code, "missing_field": field}
}

// ---------------------------------------------------------------------------
// Response types — POST /v1/buy
// ---------------------------------------------------------------------------

// BuyOrdersResponse is the body returned by POST /v1/buy. Orders is 0–3
// candidate quotes; the agent picks one and POSTs to /v1/buy/{id}/confirm.
type BuyOrdersResponse struct {
	Orders []QuoteOrder `json:"orders"`
}

// QuoteOrder is one quote returned by POST /v1/buy. The product block is
// display-only pass-through from the merchant's catalog; it isn't stored
// on the order row.
type QuoteOrder struct {
	OrderID   string        `json:"order_id"`
	Merchant  MerchantBlock `json:"merchant"`
	Product   ProductBlock  `json:"product"`
	Quote     QuoteBlock    `json:"quote"`
	ExpiresAt time.Time     `json:"expires_at"`
}

// MerchantBlock identifies the merchant. In V1 (single merchant via env
// var) `id` is the catalog's store.id slug. When multi-merchant lands and
// merchants_catalog returns, this is likely to become a UUID with `slug`
// as a separate companion field.
type MerchantBlock struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ProductBlock carries display metadata for the matched product. Not
// persisted on the order — purely informational for the agent's quote
// presentation.
type ProductBlock struct {
	SKU        string  `json:"sku"`
	Name       string  `json:"name"`
	Category   string  `json:"category"`
	ImageURL   string  `json:"image_url"`
	ProductURL string  `json:"product_url"`
	Rating     float64 `json:"rating"`
	NumReviews int     `json:"num_reviews"`
}

// QuoteBlock breaks down the cost so the agent can show the operator
// what they're being charged. total_microunits is what /confirm debits.
type QuoteBlock struct {
	SubtotalMicrounits    int64  `json:"subtotal_microunits"`
	DeliveryFeeMicrounits int64  `json:"delivery_fee_microunits"`
	TotalMicrounits       int64  `json:"total_microunits"`
	Currency              string `json:"currency"`
}

// ---------------------------------------------------------------------------
// Response types — POST /v1/buy/{id}/confirm
// ---------------------------------------------------------------------------

// ConfirmResponse is the body returned by POST /v1/buy/{id}/confirm on the
// sync-success path. Result is the merchant's opaque per-order payload.
type ConfirmResponse struct {
	OrderID string            `json:"order_id"`
	Status  dbengine.OrderStatus `json:"status"`
	Charged ChargedBlock      `json:"charged"`
	Result  json.RawMessage   `json:"result,omitempty"`
	Failure *FailureBlock     `json:"failure,omitempty"`
}

// ChargedBlock reports how much the operator's credit balance moved.
type ChargedBlock struct {
	AmountMicrounits int64 `json:"amount_microunits"`
}

// FailureBlock surfaces a merchant-returned failure (or one Sangria
// produced — e.g. unsupported_async_merchant).
type FailureBlock struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ---------------------------------------------------------------------------
// Response types — POST /v1/buy/{id}/cancel
// ---------------------------------------------------------------------------

// CancelResponse is the body returned by POST /v1/buy/{id}/cancel.
type CancelResponse struct {
	OrderID string               `json:"order_id"`
	Status  dbengine.OrderStatus `json:"status"`
}

// ---------------------------------------------------------------------------
// Response types — GET /v1/buy/{id}
// ---------------------------------------------------------------------------

// StatusResponse is the body returned by GET /v1/buy/{id}. Same shape as
// ConfirmResponse but always full — every field non-null when applicable.
type StatusResponse struct {
	OrderID               string               `json:"order_id"`
	Status                dbengine.OrderStatus `json:"status"`
	Merchant              MerchantBlock        `json:"merchant"`
	LineItems             json.RawMessage      `json:"line_items"`
	Intent                string               `json:"intent"`
	Description           string               `json:"description"`
	QuoteAmountMicrounits int64                `json:"quote_amount_microunits"`
	QuotedAt              time.Time            `json:"quoted_at"`
	ExpiresAt             time.Time            `json:"expires_at"`
	ConfirmedAt           *time.Time           `json:"confirmed_at"`
	CompletedAt           *time.Time           `json:"completed_at"`
	CancelledAt           *time.Time           `json:"cancelled_at"`
	FailedAt              *time.Time           `json:"failed_at"`
	Result                json.RawMessage      `json:"result,omitempty"`
	Charged               *ChargedBlock        `json:"charged,omitempty"`
	Failure               *FailureBlock        `json:"failure,omitempty"`
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// serializeOrder builds the GET /v1/buy/{id} response from an Order row
// plus a freshly-fetched catalog (for the merchant block). Used by both
// status.go (the GET handler) and confirm.go (the idempotent-return path
// when a sibling confirm already moved the order past awaiting_confirmation).
//
// `charged` is populated only when the order has a payment_id set (i.e.
// post-confirm); in V1 sangria-native, charged.amount_microunits ==
// order.quote_amount_microunits.
func serializeOrder(order dbengine.Order, catalog sangriamerchant.CatalogResponse) StatusResponse {
	resp := StatusResponse{
		OrderID: order.ID,
		Status:  order.Status,
		Merchant: MerchantBlock{
			ID:   catalog.Store.ID,
			Name: catalog.Store.Name,
		},
		LineItems:             order.LineItems,
		Intent:                order.Intent,
		Description:           order.Description,
		QuoteAmountMicrounits: order.QuoteAmountMicrounits,
		QuotedAt:              order.QuotedAt,
		ExpiresAt:             order.ExpiresAt,
		ConfirmedAt:           order.ConfirmedAt,
		CompletedAt:           order.CompletedAt,
		CancelledAt:           order.CancelledAt,
		FailedAt:              order.FailedAt,
		Result:                order.Result,
	}
	if order.PaymentID != nil {
		resp.Charged = &ChargedBlock{AmountMicrounits: order.QuoteAmountMicrounits}
	}
	if order.FailureCode != nil {
		msg := ""
		if order.FailureMessage != nil {
			msg = *order.FailureMessage
		}
		resp.Failure = &FailureBlock{
			Code:    *order.FailureCode,
			Message: msg,
		}
	}
	return resp
}

// serviceAreaCovers checks whether the operator's state is in the merchant's
// service area. Service area is "US-<state>" format per the reference catalog
// (e.g. ["US-CA"]); we construct the lookup key the same way and string-match.
func serviceAreaCovers(serviceArea []string, operatorState string) bool {
	if operatorState == "" {
		return false
	}
	key := fmt.Sprintf("US-%s", operatorState)
	for _, area := range serviceArea {
		if area == key {
			return true
		}
	}
	return false
}
