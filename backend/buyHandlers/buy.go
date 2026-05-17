package buyHandlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
	"sangria/backend/disco"
)

// buyRequestBody is the body the agent POSTs to /v1/buy.
type buyRequestBody struct {
	Intent      string          `json:"intent"`
	Description string          `json:"description"`
	Context     json.RawMessage `json:"context,omitempty"`
}

// Buy is the POST /v1/buy handler. Mints up to 3 candidate orders against
// the configured merchant; the agent picks one and confirms via
// POST /v1/buy/{id}/confirm.
//
// Auth: agent API key. Reads agent_api_key + agent_operator from Fiber
// locals (APIKeyAuthMiddleware sets both when key_type == "agent").
//
// Flow follows agent-sdk-planning/BUY_ENDPOINT_PLAN.md § POST /v1/buy.
func Buy(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		ctx := c.Context()

		// 1. Read locals.
		apiKey, ok := c.Locals("agent_api_key").(*dbengine.AgentAPIKey)
		if !ok || apiKey == nil {
			slog.Error("agent_api_key local missing on POST /v1/buy")
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("auth_context_missing"))
		}
		operator, ok := c.Locals("agent_operator").(*dbengine.AgentOperator)
		if !ok || operator == nil {
			slog.Error("agent_operator local missing on POST /v1/buy")
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("auth_context_missing"))
		}

		// 2. Parse + validate request.
		var body buyRequestBody
		if err := c.Bind().JSON(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(errorJSON("invalid_request_body"))
		}
		if strings.TrimSpace(body.Intent) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(errorJSONWithField("invalid_request", "intent"))
		}
		if strings.TrimSpace(body.Description) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(errorJSONWithField("invalid_request", "description"))
		}

		// 3. Validate the operator has a shipping state set. Only `state` is
		// required at /buy time (for the service-area filter); the full set
		// of address fields is checked at confirm.
		addr, err := dbengine.ParseOperatorAddress(operator.Address)
		if err != nil {
			slog.Error("parse operator address", "operator_id", operator.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("operator_address_corrupt"))
		}
		if addr.Shipping == nil || strings.TrimSpace(addr.Shipping.State) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(errorJSONWithField("missing_operator_profile", "address.shipping.state"))
		}
		operatorState := strings.TrimSpace(addr.Shipping.State)

		// 4. Read the operator's balance once for the affordability filter
		// in step 9. Stale snapshot is fine — race-safety lives in
		// CreateAgentPayment's FOR UPDATE balance check at confirm time.
		trial, paid, err := dbengine.GetAgentCreditsBalances(ctx, pool, operator.OrganizationID)
		if err != nil {
			slog.Error("read agent credit balances", "operator_id", operator.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("balance_read_failed"))
		}
		availableMicrounits := trial + paid

		// 5. Fetch the merchant catalog with a 10s budget. V1 has exactly
		// one merchant configured via MERCHANT_CATALOG_URL — no enumeration.
		catalogCtx, catalogCancel := context.WithTimeout(ctx, catalogTimeout)
		defer catalogCancel()
		catalog, err := merchantClient.FetchCatalog(catalogCtx, config.Merchant.CatalogURL)
		if err != nil {
			slog.Warn("fetch merchant catalog", "catalog_url", config.Merchant.CatalogURL, "error", err)
			return c.Status(fiber.StatusServiceUnavailable).JSON(errorJSON("merchant_unreachable"))
		}

		// 6. Service-area filter. Single merchant: if it doesn't cover the
		// operator's state, there's no fallback — return 404.
		if !serviceAreaCovers(catalog.Store.ServiceArea, operatorState) {
			return c.Status(fiber.StatusNotFound).JSON(errorJSON("no_merchant_found"))
		}

		// 7. Build ScoredProduct candidates from the catalog products.
		candidates := make([]disco.ScoredProduct, len(catalog.Products))
		for i, p := range catalog.Products {
			candidates[i] = disco.ScoredProduct{Product: p, Store: catalog.Store}
		}

		// 8. Score + top-3.
		top := disco.Top3(body.Intent+" "+body.Description, candidates)

		// 9. Affordability filter: drop candidates the operator can't afford
		// (either per-call cap or stale-snapshot balance). The balance check
		// is best-effort; CreateAgentPayment's FOR UPDATE check at confirm
		// time is the source of truth.
		deliveryMicrounits := toMicrounits(catalog.Store.Delivery.Fee)
		affordable := top[:0]
		for _, c := range top {
			subtotal := toMicrounits(c.Product.PriceUSD)
			total := subtotal + deliveryMicrounits
			if total > apiKey.MaxPerCallMicrounits {
				continue
			}
			if total > availableMicrounits {
				continue
			}
			affordable = append(affordable, c)
		}

		// 10. If nothing survived → 404.
		if len(affordable) == 0 {
			return c.Status(fiber.StatusNotFound).JSON(errorJSON("no_merchant_found"))
		}

		// 11. Mint orders. Each surviving candidate becomes one Order row
		// in awaiting_confirmation.
		now := time.Now().UTC()
		expiresAt := now.Add(quoteTTL)
		quotes := make([]QuoteOrder, 0, len(affordable))
		for _, cand := range affordable {
			subtotal := toMicrounits(cand.Product.PriceUSD)
			total := subtotal + deliveryMicrounits
			lineItems, err := json.Marshal([]map[string]any{
				{"sku": cand.Product.SKU, "quantity": 1},
			})
			if err != nil {
				// Marshal of {sku,quantity:1} is always safe; surface as 500
				// rather than silently skip.
				slog.Error("marshal line_items", "sku", cand.Product.SKU, "error", err)
				return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("internal_error"))
			}
			var contextArg json.RawMessage
			if len(body.Context) > 0 {
				contextArg = body.Context
			}
			order, err := dbengine.CreateOrder(ctx, pool, dbengine.CreateOrderParams{
				AgentAPIKeyID:         apiKey.ID,
				AgentOperatorID:       operator.ID,
				Intent:                body.Intent,
				Description:           body.Description,
				Context:               contextArg,
				LineItems:             lineItems,
				QuoteAmountMicrounits: total,
				QuotedAt:              now,
				ExpiresAt:             expiresAt,
			})
			if err != nil {
				// Order creation isn't supposed to fail under normal load —
				// surface as 500 so callers retry rather than silently
				// returning fewer quotes than scored.
				slog.Error("create order", "api_key_id", apiKey.ID, "error", err)
				return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("order_create_failed"))
			}
			quotes = append(quotes, QuoteOrder{
				OrderID: order.ID,
				Merchant: MerchantBlock{
					ID:   catalog.Store.ID,
					Name: catalog.Store.Name,
				},
				Product: ProductBlock{
					SKU:        cand.Product.SKU,
					Name:       cand.Product.Name,
					Category:   cand.Product.Category,
					ImageURL:   cand.Product.ImageURL,
					ProductURL: cand.Product.ProductURL,
					Rating:     cand.Product.Rating,
					NumReviews: cand.Product.NumReviews,
				},
				Quote: QuoteBlock{
					SubtotalMicrounits:    subtotal,
					DeliveryFeeMicrounits: deliveryMicrounits,
					TotalMicrounits:       total,
					Currency:              catalog.Store.Currency,
				},
				ExpiresAt: expiresAt,
			})
		}

		// 12. Return.
		return c.Status(fiber.StatusOK).JSON(BuyOrdersResponse{Orders: quotes})
	}
}

