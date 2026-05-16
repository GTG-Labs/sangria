package agentHandlers

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ConfirmAgentPayment is the POST /v1/agent/confirm handler.
//
// UNIMPLEMENTED. When the agent-payment ledger design is finalized, this
// handler will:
//   1. Parse request body { intent_id, payment_response }.
//   2. Read locals: agent_api_key + agent_operator.
//   3. dbengine.GetAgentPaymentByID(intent_id).
//   4. Ownership check: verify payment.APIKeyID == agent_api_key.ID — otherwise
//      404 so we don't leak existence of other operators' payments.
//   5. Branch on payment.Status:
//        - confirmed: idempotent return (200 with existing receipt)
//        - failed:    409 intent_not_pending
//        - unresolved:409 intent_unresolved (reason: use_reconcile)
//        - pending:   proceed
//   6. Parse payment_response for { success, tx_hash, settlement_amount }.
//   7. If !success: dbengine.FailAgentPayment → return 200 status=failed.
//   8. If success:
//        a. Compute platform fee from env (AGENT_PLATFORM_FEE_BPS / FLAT).
//        b. Construct []LedgerLine for the cross-currency move
//           (DEBIT operator Trial/Paid credits, CREDIT Platform Fee Revenue,
//           USDC outflow pair). Net to zero per currency.
//        c. Spend-order rule: drain Trial first, then Paid (Trial is
//           non-refundable).
//        d. dbengine.ConfirmAgentPayment with the lines.
//   9. Return receipt { intent_id, status, tx_hash, settlement_amount,
//      platform_fee, confirmed_at }.
//
// Until the ledger design lands, returns 501.
func ConfirmAgentPayment(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
			"error_code": "not_implemented",
			"message":    "agent payment confirmation requires the cross-currency ledger design which is not yet finalized",
		})
	}
}
