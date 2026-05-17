package clientHandlers

import (
	"log/slog"
	"net/url"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	dbengine "sangria/backend/dbEngine"
	"sangria/backend/utils"
)

// clientTransaction is the dashboard projection of an agent_payments row.
// Matches the existing frontend table contract:
//
//	{ id, resource, amount, currency, status, createdAt }
//
// `resource` is the merchant the agent paid (a URL or host). `amount` is
// the settled microunits if the payment is confirmed, otherwise the cap —
// the table shows "the most accurate USD value we know right now".
// `currency` is always "USDC" today because every settlement is USDC on
// Base; held as a wire field to leave room for non-USDC schemes later.
type clientTransaction struct {
	ID        string                       `json:"id"`
	Resource  string                       `json:"resource"`
	Amount    int64                        `json:"amount"`
	Currency  string                       `json:"currency"`
	Status    dbengine.AgentPaymentStatus  `json:"status"`
	CreatedAt time.Time                    `json:"createdAt"`
}

// paginatedTransactionsResponse mirrors dbengine.TransactionsResponse but
// over clientTransaction instead of MerchantTransaction. Kept local so the
// merchant DTO doesn't accidentally drift to fit the agent shape.
type paginatedTransactionsResponse struct {
	Data       []clientTransaction      `json:"data"`
	Pagination dbengine.PaginationMeta  `json:"pagination"`
}

// statusToWireStatus normalizes the AgentPayment internal statuses
// (pending / confirmed / failed / unresolved) onto the trio the client
// dashboard table understands (pending / confirmed / failed). `unresolved`
// is shown as `pending` to the human user — the reconcile pipeline will
// eventually flip it to confirmed or failed; the merchant-facing audit
// detail isn't relevant on this list view.
func statusToWireStatus(s dbengine.AgentPaymentStatus) dbengine.AgentPaymentStatus {
	if s == dbengine.AgentPaymentStatusUnresolved {
		return dbengine.AgentPaymentStatusPending
	}
	return s
}

// resourceForRow returns the human-displayable merchant identifier.
// Preserves the raw MerchantURLOrHost; the frontend can choose to truncate.
// Wrapped in a helper so future logic (e.g. strip scheme, strip path) lives
// in one place instead of spreading through the handler.
func resourceForRow(merchantURLOrHost string) string {
	// Tolerate either a bare host or a URL.
	if u, err := url.Parse(merchantURLOrHost); err == nil && u.Host != "" {
		// Path is informative for the dashboard ("api.search.example.com/query")
		// so keep host+path when present, else fall back to the raw input.
		if u.Path != "" && u.Path != "/" {
			return u.Host + u.Path
		}
		return u.Host
	}
	return merchantURLOrHost
}

// ListTransactions handles GET /internal/client/transactions. Cursor-paginated
// over agent_payments, scoped to the operator's API keys (active + revoked).
func ListTransactions(pool *pgxpool.Pool) fiber.Handler {
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

		payments, nextCursor, total, err := dbengine.ListAgentPaymentsByOperator(
			c.Context(), pool, op.Operator.ID, limit, cursor,
		)
		if err != nil {
			slog.Error("list agent payments by operator",
				"operator_id", op.Operator.ID, "error", err)
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "failed to load transactions"})
		}

		rows := make([]clientTransaction, 0, len(payments))
		for _, p := range payments {
			amount := p.MaxAmountMicrounits
			if p.SettlementAmountMicrounits != nil {
				amount = *p.SettlementAmountMicrounits
			}
			rows = append(rows, clientTransaction{
				ID:        p.ID,
				Resource:  resourceForRow(p.MerchantURLOrHost),
				Amount:    amount,
				Currency:  "USDC",
				Status:    statusToWireStatus(p.Status),
				CreatedAt: p.CreatedAt,
			})
		}

		meta := dbengine.PaginationMeta{
			HasMore: nextCursor != nil,
			Count:   len(rows),
			Limit:   limit,
			Total:   total,
		}
		if nextCursor != nil {
			encoded := utils.EncodeCursor(*nextCursor)
			meta.NextCursor = &encoded
		}

		return c.JSON(paginatedTransactionsResponse{Data: rows, Pagination: meta})
	}
}
