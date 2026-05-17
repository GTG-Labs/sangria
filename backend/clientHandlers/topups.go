package clientHandlers

import (
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/checkout/session"

	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
	"sangria/backend/utils"
)

// microunitsPerCent is the conversion factor between Sangria's internal int64
// microunits (1 USD = 1,000,000) and Stripe's int64 cents (1 USD = 100). A
// topup amount must be a whole number of cents — Sangria can't charge a
// fractional cent on a card.
const microunitsPerCent = int64(10_000)

// createTopupIntentRequest is the POST body. amountMicrounits is the credit
// the operator wants to add (must be divisible by microunitsPerCent so the
// charge maps to whole cents). idempotencyKey scopes both Stripe's
// idempotency layer and our internal agent_topups dedup.
type createTopupIntentRequest struct {
	AmountMicrounits int64  `json:"amountMicrounits"`
	IdempotencyKey   string `json:"idempotencyKey"`
}

// createTopupIntentResponse hands the frontend a hosted-checkout URL to
// redirect to. We don't load Stripe.js client-side at all — the user does
// the whole card flow on Stripe's checkout page, then returns via the
// configured success/cancel redirects. No topupId is returned because the
// agent_topups row isn't created until the checkout.session.completed
// webhook fires (so abandoned sessions don't leave dangling rows).
type createTopupIntentResponse struct {
	URL string `json:"url"`
}

// CreateTopupIntent handles POST /internal/client/topups. Creates a Stripe
// Checkout Session in payment mode (one-off charge) with the operator and
// amount stamped into metadata, and returns the hosted-checkout URL.
//
// We do NOT write an agent_topups row here — the PaymentIntent on a Checkout
// Session isn't reliably populated at session-creation time (Stripe defers
// PI creation for some payment-method collections). Instead, the
// `checkout.session.completed` webhook is the source of truth: it carries
// the session with the PI populated, plus our metadata, so it can create +
// complete the topup atomically. Sessions the user abandons never produce
// an agent_topups row, which matches what we'd want in the UI anyway.
func CreateTopupIntent(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		op, ok := resolveOperator(c, pool)
		if !ok {
			return nil
		}

		var req createTopupIntentRequest
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).
				JSON(fiber.Map{"error": "invalid request body"})
		}
		req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
		if req.IdempotencyKey == "" {
			return c.Status(fiber.StatusBadRequest).
				JSON(fiber.Map{"error": "idempotencyKey is required"})
		}
		if req.AmountMicrounits <= 0 {
			return c.Status(fiber.StatusBadRequest).
				JSON(fiber.Map{"error": "amountMicrounits must be positive"})
		}
		if req.AmountMicrounits%microunitsPerCent != 0 {
			return c.Status(fiber.StatusBadRequest).
				JSON(fiber.Map{"error": "amountMicrounits must be a whole number of cents (divisible by 10000)"})
		}
		// PaymentConfig caps every payment surface at the same ceiling so a
		// single misconfiguration can't expose more than that.
		if req.AmountMicrounits > config.PaymentConfig.MaxAmountMicrounits {
			return c.Status(fiber.StatusBadRequest).
				JSON(fiber.Map{"error": fmt.Sprintf("amountMicrounits exceeds the per-payment cap (%d)", config.PaymentConfig.MaxAmountMicrounits)})
		}

		amountCents := req.AmountMicrounits / microunitsPerCent
		frontendBase := strings.TrimSuffix(config.Email.FrontendURL, "/")
		successURL := frontendBase + "/dashboard?topup=success"
		cancelURL := frontendBase + "/dashboard?topup=cancel"

		params := &stripe.CheckoutSessionParams{
			Mode: stripe.String(string(stripe.CheckoutSessionModePayment)),
			LineItems: []*stripe.CheckoutSessionLineItemParams{
				{
					PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
						Currency: stripe.String(string(stripe.CurrencyUSD)),
						ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
							Name: stripe.String("Sangria agent top-up"),
						},
						UnitAmount: stripe.Int64(amountCents),
					},
					Quantity: stripe.Int64(1),
				},
			},
			SuccessURL: stripe.String(successURL),
			CancelURL:  stripe.String(cancelURL),
		}
		// Stamp operator/amount/idempotency on the SESSION metadata so the
		// checkout.session.completed webhook has everything it needs to
		// build the agent_topups row without a second Stripe round-trip.
		params.AddMetadata("operator_id", op.Operator.ID)
		params.AddMetadata("idempotency_key", req.IdempotencyKey)
		params.AddMetadata("amount_microunits", strconv.FormatInt(req.AmountMicrounits, 10))
		params.SetIdempotencyKey("topup-" + req.IdempotencyKey)

		sess, err := session.New(params)
		if err != nil {
			slog.Error("create stripe checkout session",
				"operator_id", op.Operator.ID, "error", err)
			return c.Status(fiber.StatusBadGateway).
				JSON(fiber.Map{"error": "failed to create checkout session"})
		}

		return c.JSON(createTopupIntentResponse{URL: sess.URL})
	}
}

// listTopupRow is the wire shape for one entry in GET /internal/client/topups.
// Mirrors AgentTopup but drops internal-only fields (idempotency_key, raw
// stripe_payment_intent_id) and reformats names to camelCase.
type listTopupRow struct {
	ID                      string                    `json:"id"`
	Direction               dbengine.Direction        `json:"direction"`
	Source                  dbengine.AgentTopupSource `json:"source"`
	AmountCreditsMicrounits int64                     `json:"amountCreditsMicrounits"`
	Status                  dbengine.AgentTopupStatus `json:"status"`
	FailureCode             *string                   `json:"failureCode"`
	FailureMessage          *string                   `json:"failureMessage"`
	CreatedAt               time.Time                 `json:"createdAt"`
	CompletedAt             *time.Time                `json:"completedAt"`
}

type listTopupsResponse struct {
	Data       []listTopupRow          `json:"data"`
	Pagination dbengine.PaginationMeta `json:"pagination"`
}

// ListTopups handles GET /internal/client/topups. Cursor-paginated billing
// history (CREDIT topups and DEBIT refund rows) for the operator.
func ListTopups(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		op, ok := resolveOperator(c, pool)
		if !ok {
			return nil
		}
		limit, cursor, err := utils.ParsePaginationParams(c.Query("limit"), c.Query("cursor"))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).
				JSON(fiber.Map{"error": "Invalid pagination parameters: " + err.Error()})
		}
		topups, nextCursor, err := dbengine.ListAgentTopupsByOperator(
			c.Context(), pool, op.Operator.ID, limit, cursor,
		)
		if err != nil {
			slog.Error("list agent topups",
				"operator_id", op.Operator.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "failed to load topups"})
		}

		rows := make([]listTopupRow, 0, len(topups))
		for _, t := range topups {
			rows = append(rows, listTopupRow{
				ID:                      t.ID,
				Direction:               t.Direction,
				Source:                  t.Source,
				AmountCreditsMicrounits: t.AmountCreditsMicrounits,
				Status:                  t.Status,
				FailureCode:             t.FailureCode,
				FailureMessage:          t.FailureMessage,
				CreatedAt:               t.CreatedAt,
				CompletedAt:             t.CompletedAt,
			})
		}

		meta := dbengine.PaginationMeta{
			HasMore: nextCursor != nil,
			Count:   len(rows),
			Limit:   limit,
		}
		if nextCursor != nil {
			encoded := utils.EncodeCursor(*nextCursor)
			meta.NextCursor = &encoded
		}

		return c.JSON(listTopupsResponse{Data: rows, Pagination: meta})
	}
}
