package dbengine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrOrderNotFound is returned by GetOrderByID when no orders row matches.
var ErrOrderNotFound = errors.New("order not found")

// ErrOrderNotInExpectedState is returned by state-transition functions when
// the row exists but isn't in a status they accept (e.g. CompleteOrder
// called on an awaiting_confirmation row). Distinct from ErrOrderNotFound
// so handlers can branch.
var ErrOrderNotInExpectedState = errors.New("order not in expected state")

// orderColumns is the canonical SELECT / RETURNING column list for orders
// rows. Keeps SQL and Scan() target order in lockstep across every function
// in this file.
const orderColumns = `id, agent_api_key_id, agent_operator_id,
	intent, description, context, status, line_items,
	quote_amount_microunits, quoted_at, expires_at,
	confirmed_at, completed_at, cancelled_at, failed_at,
	result, failure_code, failure_message,
	payment_id, created_at`

// scanOrder scans a row produced by SELECT orderColumns.
func scanOrder(row pgx.Row) (Order, error) {
	var o Order
	err := row.Scan(
		&o.ID, &o.AgentAPIKeyID, &o.AgentOperatorID,
		&o.Intent, &o.Description, &o.Context, &o.Status, &o.LineItems,
		&o.QuoteAmountMicrounits, &o.QuotedAt, &o.ExpiresAt,
		&o.ConfirmedAt, &o.CompletedAt, &o.CancelledAt, &o.FailedAt,
		&o.Result, &o.FailureCode, &o.FailureMessage,
		&o.PaymentID, &o.CreatedAt,
	)
	return o, err
}

// CreateOrderParams holds the inputs for CreateOrder.
type CreateOrderParams struct {
	AgentAPIKeyID         string
	AgentOperatorID       string
	Intent                string
	Description           string
	Context               json.RawMessage // nullable — pass nil/empty for no context
	LineItems             json.RawMessage // JSONB array of {sku, quantity}; required, non-empty
	QuoteAmountMicrounits int64
	QuotedAt              time.Time
	ExpiresAt             time.Time
}

// CreateOrder inserts a fresh orders row with status='awaiting_confirmation'.
// Orders are independent (no shared-state race), so no FOR UPDATE — the
// caller's /v1/buy handler mints up to 3 of these per request.
func CreateOrder(ctx context.Context, pool *pgxpool.Pool, params CreateOrderParams) (Order, error) {
	if err := validateCreateOrderParams(params); err != nil {
		return Order{}, err
	}

	// nil/empty context → NULL in the DB, matching the metadataArg pattern
	// elsewhere in dbEngine.
	var contextArg any
	if len(params.Context) > 0 {
		contextArg = params.Context
	}

	row := pool.QueryRow(ctx,
		`INSERT INTO orders (
			agent_api_key_id, agent_operator_id,
			intent, description, context, line_items,
			quote_amount_microunits, quoted_at, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING `+orderColumns,
		params.AgentAPIKeyID, params.AgentOperatorID,
		params.Intent, params.Description, contextArg, params.LineItems,
		params.QuoteAmountMicrounits, params.QuotedAt, params.ExpiresAt,
	)
	o, err := scanOrder(row)
	if err != nil {
		return Order{}, fmt.Errorf("insert order: %w", err)
	}
	return o, nil
}

func validateCreateOrderParams(p CreateOrderParams) error {
	if strings.TrimSpace(p.AgentAPIKeyID) == "" {
		return fmt.Errorf("agent_api_key_id must not be empty")
	}
	if strings.TrimSpace(p.AgentOperatorID) == "" {
		return fmt.Errorf("agent_operator_id must not be empty")
	}
	if strings.TrimSpace(p.Intent) == "" {
		return fmt.Errorf("intent must not be empty")
	}
	if strings.TrimSpace(p.Description) == "" {
		return fmt.Errorf("description must not be empty")
	}
	if len(p.LineItems) == 0 {
		return fmt.Errorf("line_items must not be empty")
	}
	if p.QuoteAmountMicrounits <= 0 {
		return fmt.Errorf("quote_amount_microunits must be positive, got %d", p.QuoteAmountMicrounits)
	}
	if p.QuotedAt.IsZero() {
		return fmt.Errorf("quoted_at must be set")
	}
	if p.ExpiresAt.IsZero() {
		return fmt.Errorf("expires_at must be set")
	}
	if !p.ExpiresAt.After(p.QuotedAt) {
		return fmt.Errorf("expires_at must be after quoted_at")
	}
	return nil
}

// GetOrderByID returns the orders row with the given ID. Returns
// ErrOrderNotFound when no row matches.
func GetOrderByID(ctx context.Context, pool *pgxpool.Pool, orderID string) (Order, error) {
	if strings.TrimSpace(orderID) == "" {
		return Order{}, fmt.Errorf("order ID must not be empty")
	}
	row := pool.QueryRow(ctx,
		`SELECT `+orderColumns+` FROM orders WHERE id = $1`,
		orderID,
	)
	o, err := scanOrder(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Order{}, ErrOrderNotFound
	}
	if err != nil {
		return Order{}, fmt.Errorf("get order by ID: %w", err)
	}
	return o, nil
}

// ListOrdersByOperator returns the operator's orders in newest-first order,
// paginated by created_at cursor. Mirrors the ListAgentTopupsByOperator
// pattern: fetches limit+1 to peek-ahead for nextCursor; returns nil cursor
// when there are no more pages.
//
// Operator-scoped (not key-scoped) per the "reads cross keys, mutates don't"
// rule — any agent key under the same operator can list the operator's
// orders for the dashboard view.
func ListOrdersByOperator(ctx context.Context, pool *pgxpool.Pool, agentOperatorID string, limit int, cursor *time.Time) ([]Order, *time.Time, error) {
	if strings.TrimSpace(agentOperatorID) == "" {
		return nil, nil, fmt.Errorf("agent operator ID must not be empty")
	}
	if limit <= 0 {
		return nil, nil, fmt.Errorf("limit must be positive, got %d", limit)
	}

	args := []any{agentOperatorID}
	cursorWhere := ""
	if cursor != nil {
		cursorWhere = " AND created_at < $2"
		args = append(args, *cursor)
	}
	args = append(args, limit+1)
	limitParam := len(args)

	query := fmt.Sprintf(
		`SELECT `+orderColumns+`
		 FROM orders
		 WHERE agent_operator_id = $1%s
		 ORDER BY created_at DESC
		 LIMIT $%d`,
		cursorWhere, limitParam,
	)

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("query orders: %w", err)
	}
	defer rows.Close()

	orders := []Order{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, nil, fmt.Errorf("scan order: %w", err)
		}
		orders = append(orders, o)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate orders: %w", err)
	}

	var nextCursor *time.Time
	if len(orders) > limit {
		orders = orders[:limit]
		last := orders[len(orders)-1].CreatedAt
		nextCursor = &last
	}
	return orders, nextCursor, nil
}

// ConfirmOrder atomically transitions awaiting_confirmation → running,
// stamping confirmed_at and linking the payment row. Race-safe by design:
// if the UPDATE matches zero rows (a concurrent confirm already moved the
// row), a follow-up SELECT inside the same tx returns the current state
// and the alreadyConfirmed flag is set.
//
// Returns:
//
//	(order, false, nil) — UPDATE succeeded; caller is the winner.
//	(order, true,  nil) — order is already past awaiting_confirmation
//	                      (running / completed / failed / cancelled).
//	                      Caller should NOT call the merchant; should
//	                      return the current state idempotently.
//	(zero, _, err)      — order not found, DB error, or the row is somehow
//	                      still in awaiting_confirmation after the UPDATE
//	                      failed (anomaly worth surfacing).
//
// This signature exists to close the concurrent /confirm race described in
// agent-sdk-planning/BUY_ENDPOINT_PLAN.md § /v1/buy/{order_id}/confirm —
// the realistic trigger is the agent's HTTP retry after a network blip on
// the first call.
func ConfirmOrder(ctx context.Context, pool *pgxpool.Pool, orderID, paymentID string) (Order, bool, error) {
	if strings.TrimSpace(orderID) == "" {
		return Order{}, false, fmt.Errorf("order ID must not be empty")
	}
	if strings.TrimSpace(paymentID) == "" {
		return Order{}, false, fmt.Errorf("payment ID must not be empty")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return Order{}, false, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	row := tx.QueryRow(ctx,
		`UPDATE orders SET
			status = 'running',
			confirmed_at = NOW(),
			payment_id = $2
		 WHERE id = $1 AND status = 'awaiting_confirmation'
		 RETURNING `+orderColumns,
		orderID, paymentID,
	)
	o, scanErr := scanOrder(row)
	if scanErr == nil {
		if err := tx.Commit(ctx); err != nil {
			return Order{}, false, fmt.Errorf("commit: %w", err)
		}
		return o, false, nil
	}
	if !errors.Is(scanErr, pgx.ErrNoRows) {
		return Order{}, false, fmt.Errorf("update order to running: %w", scanErr)
	}

	// UPDATE matched zero rows — either the row doesn't exist, or it's no
	// longer in awaiting_confirmation (concurrent confirm / cancel). Read
	// the current state under the same tx so we can tell those cases apart.
	row = tx.QueryRow(ctx,
		`SELECT `+orderColumns+` FROM orders WHERE id = $1`,
		orderID,
	)
	current, lookupErr := scanOrder(row)
	if errors.Is(lookupErr, pgx.ErrNoRows) {
		return Order{}, false, ErrOrderNotFound
	}
	if lookupErr != nil {
		return Order{}, false, fmt.Errorf("lookup current order state: %w", lookupErr)
	}

	if current.Status == OrderStatusAwaitingConfirmation {
		// Anomaly: row exists in the right state but UPDATE didn't match.
		// Should never happen under normal conditions; surface as error.
		return Order{}, false, fmt.Errorf("order %s in awaiting_confirmation but UPDATE matched no rows", orderID)
	}

	if err := tx.Commit(ctx); err != nil {
		return Order{}, false, fmt.Errorf("commit: %w", err)
	}
	return current, true, nil
}

// CompleteOrder atomically transitions running → completed, stamping
// completed_at and storing the merchant's opaque result payload. Returns
// ErrOrderNotInExpectedState if the row isn't in running. Returns
// ErrOrderNotFound if no row matches.
func CompleteOrder(ctx context.Context, pool *pgxpool.Pool, orderID string, result json.RawMessage) (Order, error) {
	if strings.TrimSpace(orderID) == "" {
		return Order{}, fmt.Errorf("order ID must not be empty")
	}
	if len(result) == 0 {
		return Order{}, fmt.Errorf("result must not be empty")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return Order{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	row := tx.QueryRow(ctx,
		`UPDATE orders SET
			status = 'completed',
			completed_at = NOW(),
			result = $2
		 WHERE id = $1 AND status = 'running'
		 RETURNING `+orderColumns,
		orderID, result,
	)
	o, scanErr := scanOrder(row)
	if scanErr == nil {
		if err := tx.Commit(ctx); err != nil {
			return Order{}, fmt.Errorf("commit: %w", err)
		}
		return o, nil
	}
	if !errors.Is(scanErr, pgx.ErrNoRows) {
		return Order{}, fmt.Errorf("update order to completed: %w", scanErr)
	}
	return Order{}, classifyOrderTransitionMiss(ctx, tx, orderID)
}

// FailOrder atomically transitions running → failed OR awaiting_confirmation
// → failed, stamping failed_at and recording failureCode + failureMessage.
// Both source states are accepted because merchant call failures can happen
// before the order ever reaches running (e.g. unsupported_async_merchant
// rejection in the confirm handler).
//
// Returns ErrOrderNotInExpectedState if the row is already terminal
// (completed / failed / cancelled). Returns ErrOrderNotFound if no row
// matches.
func FailOrder(ctx context.Context, pool *pgxpool.Pool, orderID, failureCode, failureMessage string) (Order, error) {
	if strings.TrimSpace(orderID) == "" {
		return Order{}, fmt.Errorf("order ID must not be empty")
	}
	if strings.TrimSpace(failureCode) == "" {
		return Order{}, fmt.Errorf("failure_code must not be empty")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return Order{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	row := tx.QueryRow(ctx,
		`UPDATE orders SET
			status = 'failed',
			failed_at = NOW(),
			failure_code = $2,
			failure_message = $3
		 WHERE id = $1 AND status IN ('running', 'awaiting_confirmation')
		 RETURNING `+orderColumns,
		orderID, failureCode, failureMessage,
	)
	o, scanErr := scanOrder(row)
	if scanErr == nil {
		if err := tx.Commit(ctx); err != nil {
			return Order{}, fmt.Errorf("commit: %w", err)
		}
		return o, nil
	}
	if !errors.Is(scanErr, pgx.ErrNoRows) {
		return Order{}, fmt.Errorf("update order to failed: %w", scanErr)
	}
	return Order{}, classifyOrderTransitionMiss(ctx, tx, orderID)
}

// CancelOrder atomically transitions awaiting_confirmation → cancelled,
// stamping cancelled_at. Returns ErrOrderNotInExpectedState if the row is
// already in any non-cancellable state (running / completed / failed /
// already cancelled). Returns ErrOrderNotFound if no row matches.
func CancelOrder(ctx context.Context, pool *pgxpool.Pool, orderID string) (Order, error) {
	if strings.TrimSpace(orderID) == "" {
		return Order{}, fmt.Errorf("order ID must not be empty")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return Order{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	row := tx.QueryRow(ctx,
		`UPDATE orders SET
			status = 'cancelled',
			cancelled_at = NOW()
		 WHERE id = $1 AND status = 'awaiting_confirmation'
		 RETURNING `+orderColumns,
		orderID,
	)
	o, scanErr := scanOrder(row)
	if scanErr == nil {
		if err := tx.Commit(ctx); err != nil {
			return Order{}, fmt.Errorf("commit: %w", err)
		}
		return o, nil
	}
	if !errors.Is(scanErr, pgx.ErrNoRows) {
		return Order{}, fmt.Errorf("update order to cancelled: %w", scanErr)
	}
	return Order{}, classifyOrderTransitionMiss(ctx, tx, orderID)
}

// classifyOrderTransitionMiss distinguishes "row doesn't exist" from "row
// exists but wasn't in an acceptable source state" after a status-gated
// UPDATE matches zero rows. Shared between Complete/Fail/Cancel since they
// all have the same disambiguation need.
func classifyOrderTransitionMiss(ctx context.Context, tx pgx.Tx, orderID string) error {
	var exists bool
	err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM orders WHERE id = $1)`,
		orderID,
	).Scan(&exists)
	if err != nil {
		return fmt.Errorf("classify transition miss: %w", err)
	}
	if !exists {
		return ErrOrderNotFound
	}
	return ErrOrderNotInExpectedState
}
