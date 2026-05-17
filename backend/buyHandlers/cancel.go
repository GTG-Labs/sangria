package buyHandlers

import (
	"errors"
	"log/slog"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangria/backend/dbEngine"
)

// Cancel is the POST /v1/buy/{id}/cancel handler. Transitions an
// awaiting_confirmation order to cancelled. Idempotent on already-cancelled;
// 409 on any other terminal state.
//
// Auth: agent API key. Mutating endpoint — key-scoped ownership (only the
// agent key that created the quote can cancel it).
func Cancel(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		ctx := c.Context()

		apiKey, ok := c.Locals("agent_api_key").(*dbengine.AgentAPIKey)
		if !ok || apiKey == nil {
			slog.Error("agent_api_key local missing on POST /v1/buy/:id/cancel")
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("auth_context_missing"))
		}
		orderID := strings.TrimSpace(c.Params("id"))
		if orderID == "" {
			return c.Status(fiber.StatusBadRequest).JSON(errorJSONWithField("invalid_request", "id"))
		}

		// Look up + ownership check (mutate — key-scoped).
		order, err := dbengine.GetOrderByID(ctx, pool, orderID)
		if errors.Is(err, dbengine.ErrOrderNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(errorJSON("not_found"))
		}
		if err != nil {
			slog.Error("get order by ID", "order_id", orderID, "error", err)
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("order_read_failed"))
		}
		if order.AgentAPIKeyID != apiKey.ID {
			return c.Status(fiber.StatusNotFound).JSON(errorJSON("not_found"))
		}

		// Idempotent: if already cancelled, hand back the current state.
		if order.Status == dbengine.OrderStatusCancelled {
			return c.Status(fiber.StatusOK).JSON(CancelResponse{
				OrderID: order.ID,
				Status:  order.Status,
			})
		}

		// CancelOrder accepts only awaiting_confirmation as source. Any
		// other state → 409 already_terminal.
		cancelled, err := dbengine.CancelOrder(ctx, pool, orderID)
		if errors.Is(err, dbengine.ErrOrderNotInExpectedState) {
			return c.Status(fiber.StatusConflict).JSON(errorJSON("already_terminal"))
		}
		if errors.Is(err, dbengine.ErrOrderNotFound) {
			// Shouldn't happen — we just read the row. Concurrent admin
			// deletion is the only plausible cause.
			return c.Status(fiber.StatusNotFound).JSON(errorJSON("not_found"))
		}
		if err != nil {
			slog.Error("cancel order", "order_id", orderID, "error", err)
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("order_cancel_failed"))
		}

		return c.Status(fiber.StatusOK).JSON(CancelResponse{
			OrderID: cancelled.ID,
			Status:  cancelled.Status,
		})
	}
}
