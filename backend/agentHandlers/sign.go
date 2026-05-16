package agentHandlers

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SignAgentPayment is the POST /v1/agent/sign handler.
//
// UNIMPLEMENTED. When the CDP signing integration is wired in, this handler
// will:
//   1. Parse the SDK's request (idempotency_key, merchant_url,
//      payment_required, max_amount_microunits, optional metadata).
//   2. Read locals: agent_api_key + agent_operator (set by APIKeyAuthMiddleware).
//   3. Idempotent short-circuit via dbengine.GetAgentPaymentByIdempotencyKey.
//   4. Pick a compatible accept entry from payment_required.accepts.
//   5. Cap-check requested amount against agent_api_key spend caps
//      (max_per_call; daily/monthly are a follow-up).
//   6. Pre-check operator balance via dbengine.GetAgentCreditsBalances.
//   7. Call cdpHandlers.SignTypedData with the constructed ERC-3009 (for
//      scheme=exact) or Permit2 (for scheme=upto) payload.
//   8. Persist via dbengine.CreateAgentPayment (which does the FOR UPDATE
//      lock + balance recheck + insert atomically).
//   9. Return { intent_id, payment_signature_b64, valid_before }.
//
// Until CDP lands, returns 501.
func SignAgentPayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
			"error_code": "not_implemented",
			"message":    "agent payment signing requires the CDP integration which is not yet wired in",
		})
	}
}
