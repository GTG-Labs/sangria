package agentHandlers

import (
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangria/backend/dbEngine"
)

// GetAgentBalance is the GET /v1/agent/balance handler. Returns the
// authenticated operator's Trial + Paid credit balances (in microunits) plus
// the sum as `total_microunits` so clients don't need to add it themselves.
//
// Auth: agent API key. Reads `agent_operator` from Fiber locals; APIKeyAuth
// Middleware guarantees it's set when key_type == "agent".
func GetAgentBalance(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		operator, ok := c.Locals("agent_operator").(*dbengine.AgentOperator)
		if !ok || operator == nil {
			slog.Error("agent_operator local missing or wrong type on GET /v1/agent/balance")
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error_code": "internal_error",
				"message":    "authentication context missing",
			})
		}

		trial, paid, err := dbengine.GetAgentCreditsBalances(c.Context(), pool, operator.OrganizationID)
		if err != nil {
			slog.Error("get agent credits balances", "operator_id", operator.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error_code": "internal_error",
				"message":    "failed to read balance",
			})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"trial_microunits": trial,
			"paid_microunits":  paid,
			"total_microunits": trial + paid,
		})
	}
}
