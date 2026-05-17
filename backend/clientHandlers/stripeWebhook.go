package clientHandlers

import (
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/webhook"

	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
)

// HandleStripeWebhook is the public POST /webhooks/stripe handler. The route
// is unauthenticated by design — Stripe authenticates the call via the
// HMAC-signed Stripe-Signature header, which webhook.ConstructEvent verifies
// against config.Stripe.WebhookSecret.
//
// We return 200 (with an empty JSON body) on every well-formed event, even
// when the event is for an unknown session or already-completed topup —
// Stripe interprets non-2xx as "redeliver", and we don't want a stale
// retry for an event we've already processed to trigger a redelivery storm.
// True errors (signature mismatch, malformed payload, unrecoverable DB
// errors) return 4xx/5xx so Stripe will retry.
func HandleStripeWebhook(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		payload := c.Body()
		signature := c.Get("Stripe-Signature")

		// IgnoreAPIVersionMismatch: our Stripe dashboard account uses a newer
		// API version (e.g. dahlia) than stripe-go v82 was built against
		// (basil). The on-the-wire JSON shape we care about (session
		// metadata + payment_intent ID) hasn't changed across these
		// versions, so accepting the mismatch is safe. If we ever rely on
		// newer-version-only fields we should re-evaluate.
		event, err := webhook.ConstructEventWithOptions(
			payload, signature, config.Stripe.WebhookSecret,
			webhook.ConstructEventOptions{IgnoreAPIVersionMismatch: true},
		)
		if err != nil {
			slog.Warn("stripe webhook signature verification failed",
				"error", err)
			return c.Status(fiber.StatusBadRequest).
				JSON(fiber.Map{"error": "invalid signature"})
		}

		switch event.Type {
		case "checkout.session.completed":
			return handleCheckoutSessionCompleted(c, pool, event)
		case "checkout.session.expired", "checkout.session.async_payment_failed":
			// We never wrote a pending row for these sessions, so there's
			// nothing in our DB to fail. Just ACK.
			slog.Debug("stripe checkout session abandoned/failed",
				"event_type", event.Type, "event_id", event.ID)
			return c.JSON(fiber.Map{"received": true})
		default:
			// Unhandled event types still ACK so Stripe doesn't redeliver.
			// Logged so we notice if an important new event type starts
			// arriving without a handler.
			slog.Debug("stripe webhook event ignored",
				"event_type", event.Type, "event_id", event.ID)
			return c.JSON(fiber.Map{"received": true})
		}
	}
}

// handleCheckoutSessionCompleted creates + completes the agent_topups row in
// one shot. We didn't write a pending row at session creation time (because
// the PaymentIntent ID isn't reliably populated then); the session-completed
// event carries the full session with metadata + PI ID, so we can build the
// row from the event alone.
//
// All "expected" outcomes ACK with 200:
//   - first delivery → row created + completed
//   - duplicate delivery → CreateAgentTopup short-circuits on the unique
//     (operator_id, idempotency_key); CompleteStripeAgentTopup is idempotent
//     on already-completed rows
//   - session missing metadata → log + ACK (someone created a session by
//     hand against our endpoint without our usual metadata; not retriable)
func handleCheckoutSessionCompleted(c fiber.Ctx, pool *pgxpool.Pool, event stripe.Event) error {
	var sess stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &sess); err != nil {
		slog.Error("decode checkout.session.completed payload",
			"event_id", event.ID, "error", err)
		return c.Status(fiber.StatusBadRequest).
			JSON(fiber.Map{"error": "invalid payload"})
	}

	operatorID := sess.Metadata["operator_id"]
	idempotencyKey := sess.Metadata["idempotency_key"]
	amountRaw := sess.Metadata["amount_microunits"]

	if operatorID == "" || idempotencyKey == "" || amountRaw == "" {
		// Missing metadata — persist an unresolved topup record so the funds can
		// be reconciled by hand. The webhook acks to prevent redelivery storm,
		// but the durable unresolved row ensures the charge isn't silently dropped.
		missingFields := []string{}
		if operatorID == "" {
			missingFields = append(missingFields, "operator_id")
		}
		if idempotencyKey == "" {
			missingFields = append(missingFields, "idempotency_key")
		}
		if amountRaw == "" {
			missingFields = append(missingFields, "amount_microunits")
		}
		slog.Error("stripe session missing sangria metadata",
			"session_id", sess.ID, "event_id", event.ID, "missing_fields", missingFields)
		// Return error to trigger Stripe retry — without all required metadata
		// we cannot persist a topup row (no operator_id, no idempotency_key).
		// Manual reconciliation requires admin intervention with the raw event data.
		return c.Status(fiber.StatusInternalServerError).
			JSON(fiber.Map{"error": "session missing required metadata"})
	}
	amountMicrounits, err := strconv.ParseInt(amountRaw, 10, 64)
	if err != nil || amountMicrounits <= 0 {
		slog.Error("invalid amount_microunits in session metadata",
			"session_id", sess.ID, "event_id", event.ID, "amount_raw", amountRaw, "error", err)
		// Return error to trigger Stripe retry — invalid amount prevents topup
		// creation just like missing metadata. Admin can reconcile from Stripe
		// dashboard + event logs if this persists.
		return c.Status(fiber.StatusInternalServerError).
			JSON(fiber.Map{"error": "invalid amount_microunits in metadata"})
	}

	// PaymentIntent is populated on the session by the time this event
	// fires — Stripe has created the PI to capture funds. If for some
	// edge case it's still missing, we can't link the topup to a PI and
	// skip; the funds were charged but our books won't reflect them.
	// Logged loudly so it can be reconciled by hand.
	var piID string
	if sess.PaymentIntent != nil {
		piID = sess.PaymentIntent.ID
	}
	if piID == "" {
		slog.Error("checkout.session.completed without payment intent",
			"session_id", sess.ID, "event_id", event.ID,
			"operator_id", operatorID, "amount_microunits", amountMicrounits)
		return c.Status(fiber.StatusInternalServerError).
			JSON(fiber.Map{"error": "session missing payment intent"})
	}

	// Step 1: create the pending agent_topups row. Idempotent on
	// (agent_operator_id, idempotency_key) — a Stripe redelivery just
	// returns the existing row.
	topup, err := dbengine.CreateAgentTopup(c.Context(), pool, dbengine.CreateAgentTopupParams{
		AgentOperatorID:         operatorID,
		Direction:               dbengine.Credit,
		Source:                  dbengine.AgentTopupSourceStripeCard,
		AmountCreditsMicrounits: amountMicrounits,
		IdempotencyKey:          idempotencyKey,
		StripePaymentIntentID:   stripe.String(piID),
	})
	if err != nil {
		slog.Error("create agent topup from session",
			"session_id", sess.ID, "event_id", event.ID, "error", err)
		return c.Status(fiber.StatusInternalServerError).
			JSON(fiber.Map{"error": "failed to record topup"})
	}

	// Step 2: write the ledger entries and flip the row to completed.
	completed, err := dbengine.CompleteStripeAgentTopup(c.Context(), pool, piID)
	if err != nil {
		switch {
		case errors.Is(err, dbengine.ErrAgentTopupNotFound):
			// Shouldn't happen — we just inserted the row above. Return 5xx so
			// Stripe redelivers: the create path is idempotent on
			// (operator_id, idempotency_key) and complete is idempotent on PI,
			// so a retry either succeeds (whatever transient state cleared) or
			// surfaces the same anomaly again instead of silently swallowing it.
			slog.Error("stripe webhook: row vanished between create and complete",
				"topup_id", topup.ID, "pi_id", piID, "event_id", event.ID)
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "topup row vanished after create"})
		case errors.Is(err, dbengine.ErrAgentTopupAlreadyFailed):
			slog.Warn("stripe webhook: completed event for failed topup",
				"topup_id", topup.ID, "pi_id", piID, "event_id", event.ID)
			return c.JSON(fiber.Map{"received": true})
		default:
			slog.Error("complete stripe agent topup",
				"topup_id", topup.ID, "pi_id", piID, "event_id", event.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "failed to complete topup"})
		}
	}
	slog.Info("stripe agent topup completed",
		"topup_id", completed.ID, "operator_id", completed.AgentOperatorID,
		"amount_microunits", completed.AmountCreditsMicrounits)
	return c.JSON(fiber.Map{"received": true})
}
