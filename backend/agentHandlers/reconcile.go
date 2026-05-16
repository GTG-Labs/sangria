package agentHandlers

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ReconcileAgentPayment is the POST /v1/agent/reconcile/:intent_id handler.
//
// UNIMPLEMENTED. Depends on (a) on-chain state checking and (b) the same
// ledger design that ConfirmAgentPayment is blocked on. When both land, this
// handler will:
//   1. Parse intent_id from path.
//   2. Read locals: agent_api_key.
//   3. dbengine.GetAgentPaymentByID(intent_id) + ownership check.
//   4. Branch on payment.Status:
//        - confirmed or failed: idempotent return
//        - pending:    transition to unresolved first via
//                      dbengine.MarkAgentPaymentUnresolved, then proceed
//        - unresolved: proceed to chain check
//   5. Query Coinbase facilitator + on-chain authorizationState(from, nonce)
//      to determine whether the ERC-3009 authorization was consumed.
//   6. If consumed on-chain: build the same ledger lines as ConfirmAgentPayment
//      (using chain-derived settlement_amount) and call
//      dbengine.ConfirmAgentPayment.
//   7. If valid_before passed and not consumed:
//      dbengine.FailAgentPayment with code 'authorization_expired'.
//   8. If still in flight: leave as unresolved, return 200 status=unresolved.
//   9. Return updated payment status.
//
// Until the chain-check + ledger design land, returns 501.
func ReconcileAgentPayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
			"error_code": "not_implemented",
			"message":    "agent payment reconciliation requires the on-chain state check + ledger design which are not yet wired in",
		})
	}
}
