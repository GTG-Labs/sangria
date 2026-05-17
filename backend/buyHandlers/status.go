package buyHandlers

import (
	"context"
	"errors"
	"log/slog"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
)

// Status is the GET /v1/buy/{id} handler. Returns the order's full current
// state including the merchant block. Pure read; agents poll this to track
// async-ish state transitions.
//
// Auth: agent API key. Read endpoint — operator-scoped ownership (any
// sibling key under the same operator can poll the order's state).
func Status(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		ctx := c.Context()

		operator, ok := c.Locals("agent_operator").(*dbengine.AgentOperator)
		if !ok || operator == nil {
			slog.Error("agent_operator local missing on GET /v1/buy/:id")
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("auth_context_missing"))
		}
		orderID := strings.TrimSpace(c.Params("id"))
		if orderID == "" {
			return c.Status(fiber.StatusBadRequest).JSON(errorJSONWithField("invalid_request", "id"))
		}

		order, err := dbengine.GetOrderByID(ctx, pool, orderID)
		if errors.Is(err, dbengine.ErrOrderNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(errorJSON("not_found"))
		}
		if err != nil {
			slog.Error("get order by ID", "order_id", orderID, "error", err)
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("order_read_failed"))
		}

		// Ownership check — read endpoint, operator-scoped. Any sibling
		// key under the same operator can read.
		if order.AgentOperatorID != operator.ID {
			return c.Status(fiber.StatusNotFound).JSON(errorJSON("not_found"))
		}

		// Fetch the catalog for the merchant block. 503 fail-closed if
		// unreachable rather than omit the block — "you can't tell which
		// merchant this is" is worse UX than a transient 503.
		catalogCtx, cancel := context.WithTimeout(ctx, catalogTimeout)
		defer cancel()
		catalog, err := merchantClient.FetchCatalog(catalogCtx, config.Merchant.CatalogURL)
		if err != nil {
			slog.Warn("fetch merchant catalog for status", "order_id", orderID, "error", err)
			return c.Status(fiber.StatusServiceUnavailable).JSON(errorJSON("merchant_unreachable"))
		}

		return c.Status(fiber.StatusOK).JSON(serializeOrder(order, catalog))
	}
}
