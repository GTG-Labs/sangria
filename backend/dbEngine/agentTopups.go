package dbengine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// agentTopupColumns is the canonical SELECT / RETURNING column list for
// agent_topups rows. Keeps SQL and Scan() target order in lockstep.
const agentTopupColumns = `id, agent_operator_id, direction, source, amount_credits_microunits,
	idempotency_key, stripe_payment_intent_id, bridge_transaction_id,
	ledger_transaction_id, status, failure_code, failure_message,
	created_at, completed_at`

// validAgentTopupSources enumerates the source values accepted at the Go layer.
// Mirrors agentTopupSourceEnum in the schema; DB enum is the final guarantee.
var validAgentTopupSources = map[AgentTopupSource]bool{
	AgentTopupSourceTrial:        true,
	AgentTopupSourceStripeCard:   true,
	AgentTopupSourceStripeACH:    true,
	AgentTopupSourceWire:         true,
	AgentTopupSourceDirectUSDC:   true,
	AgentTopupSourceStripeRefund: true,
}

// scanAgentTopup scans a row produced by SELECT agentTopupColumns.
func scanAgentTopup(row pgx.Row) (AgentTopup, error) {
	var t AgentTopup
	err := row.Scan(
		&t.ID, &t.AgentOperatorID, &t.Direction, &t.Source, &t.AmountCreditsMicrounits,
		&t.IdempotencyKey, &t.StripePaymentIntentID, &t.BridgeTransactionID,
		&t.LedgerTransactionID, &t.Status, &t.FailureCode, &t.FailureMessage,
		&t.CreatedAt, &t.CompletedAt,
	)
	return t, err
}

// CreateAgentTopupParams holds the inputs for CreateAgentTopup. Caller assembles
// these from the webhook payload (Stripe) or admin tool input (wire/USDC).
type CreateAgentTopupParams struct {
	AgentOperatorID         string
	Direction               Direction          // CREDIT for topups, DEBIT for stripe_refund rows
	Source                  AgentTopupSource
	AmountCreditsMicrounits int64
	IdempotencyKey          string             // per-source convention (Stripe PI, refund_id, etc.)
	StripePaymentIntentID   *string            // required for stripe_card / stripe_ach / stripe_refund
	BridgeTransactionID     *string
}

// CreateAgentTopup inserts a pending agent_topups row. Idempotent on
// (agent_operator_id, idempotency_key) — a duplicate Stripe webhook delivery
// returns the existing row instead of creating a second one. Source +
// direction coherence (DEBIT ⟺ source='stripe_refund', stripe_* sources
// require PI) is enforced by DB CHECK constraints; this function does light
// Go-side validation for better error messages on common typos.
func CreateAgentTopup(ctx context.Context, pool *pgxpool.Pool, params CreateAgentTopupParams) (AgentTopup, error) {
	if err := validateCreateAgentTopupParams(params); err != nil {
		return AgentTopup{}, err
	}

	row := pool.QueryRow(ctx,
		`INSERT INTO agent_topups (
			agent_operator_id, direction, source, amount_credits_microunits,
			idempotency_key, stripe_payment_intent_id, bridge_transaction_id, status
		) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
		ON CONFLICT ON CONSTRAINT uq_agent_topups_operator_idempotency_key DO NOTHING
		RETURNING `+agentTopupColumns,
		params.AgentOperatorID, params.Direction, params.Source, params.AmountCreditsMicrounits,
		params.IdempotencyKey, params.StripePaymentIntentID, params.BridgeTransactionID,
	)
	t, err := scanAgentTopup(row)
	if err == nil {
		return t, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return AgentTopup{}, fmt.Errorf("insert agent topup: %w", err)
	}

	// Conflict — same (operator, idempotency_key) row already exists. Return it.
	row = pool.QueryRow(ctx,
		`SELECT `+agentTopupColumns+`
		 FROM agent_topups
		 WHERE agent_operator_id = $1 AND idempotency_key = $2`,
		params.AgentOperatorID, params.IdempotencyKey,
	)
	t, err = scanAgentTopup(row)
	if err != nil {
		return AgentTopup{}, fmt.Errorf("read existing agent topup after conflict: %w", err)
	}
	return t, nil
}

// validateCreateAgentTopupParams runs defensive Go-side checks. Schema CHECKs
// are the final guarantee; this layer just gives better error messages.
func validateCreateAgentTopupParams(p CreateAgentTopupParams) error {
	if strings.TrimSpace(p.AgentOperatorID) == "" {
		return fmt.Errorf("agent operator ID must not be empty")
	}
	if !validDirections[p.Direction] {
		return fmt.Errorf("invalid direction %q (must be DEBIT or CREDIT)", p.Direction)
	}
	if !validAgentTopupSources[p.Source] {
		return fmt.Errorf("invalid source %q", p.Source)
	}
	if p.AmountCreditsMicrounits <= 0 {
		return fmt.Errorf("amount must be positive, got %d", p.AmountCreditsMicrounits)
	}
	if strings.TrimSpace(p.IdempotencyKey) == "" {
		return fmt.Errorf("idempotency key must not be empty")
	}
	return nil
}

// MarkAgentTopupCompleted transitions a pending topup → completed and records
// the ledger transaction ID that paired with it. Returns an error if the row
// is not in pending state (e.g. concurrent webhook already completed it, or a
// programmer called Mark twice). Mirrors the merchant-side ConfirmTransaction
// "only pending → next state" discipline.
func MarkAgentTopupCompleted(ctx context.Context, pool *pgxpool.Pool, topupID, ledgerTransactionID string) error {
	if strings.TrimSpace(topupID) == "" {
		return fmt.Errorf("topup ID must not be empty")
	}
	if strings.TrimSpace(ledgerTransactionID) == "" {
		return fmt.Errorf("ledger transaction ID must not be empty")
	}
	result, err := pool.Exec(ctx,
		`UPDATE agent_topups
		 SET status = 'completed', completed_at = NOW(), ledger_transaction_id = $2
		 WHERE id = $1 AND status = 'pending'`,
		topupID, ledgerTransactionID,
	)
	if err != nil {
		return fmt.Errorf("mark agent topup completed: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("agent topup %s is not in pending state", topupID)
	}
	return nil
}

// MarkAgentTopupFailed transitions a pending topup → failed and records the
// failure reason. Returns an error if the row is not in pending state.
func MarkAgentTopupFailed(ctx context.Context, pool *pgxpool.Pool, topupID, failureCode, failureMessage string) error {
	if strings.TrimSpace(topupID) == "" {
		return fmt.Errorf("topup ID must not be empty")
	}
	if strings.TrimSpace(failureCode) == "" {
		return fmt.Errorf("failure code must not be empty")
	}
	result, err := pool.Exec(ctx,
		`UPDATE agent_topups
		 SET status = 'failed', failure_code = $2, failure_message = $3
		 WHERE id = $1 AND status = 'pending'`,
		topupID, failureCode, failureMessage,
	)
	if err != nil {
		return fmt.Errorf("mark agent topup failed: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("agent topup %s is not in pending state", topupID)
	}
	return nil
}

// GetAgentTopupByID returns the topup row with the given ID. Returns
// pgx.ErrNoRows if no row matches — callers wrap as appropriate (no dedicated
// sentinel since this is typically called right after CreateAgentTopup or
// from admin tooling where the ID is known-good).
func GetAgentTopupByID(ctx context.Context, pool *pgxpool.Pool, topupID string) (AgentTopup, error) {
	if strings.TrimSpace(topupID) == "" {
		return AgentTopup{}, fmt.Errorf("topup ID must not be empty")
	}
	row := pool.QueryRow(ctx,
		`SELECT `+agentTopupColumns+` FROM agent_topups WHERE id = $1`,
		topupID,
	)
	t, err := scanAgentTopup(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentTopup{}, err
		}
		return AgentTopup{}, fmt.Errorf("get agent topup by ID: %w", err)
	}
	return t, nil
}

// GetAgentTopupByStripePaymentIntentID returns the topup row with the given
// Stripe PaymentIntent ID. Used by refund webhooks: given the PI of the
// original charge, find the CREDIT topup row to know which operator + amount
// to refund against. Returns pgx.ErrNoRows if no row matches.
func GetAgentTopupByStripePaymentIntentID(ctx context.Context, pool *pgxpool.Pool, stripePaymentIntentID string) (AgentTopup, error) {
	if strings.TrimSpace(stripePaymentIntentID) == "" {
		return AgentTopup{}, fmt.Errorf("stripe payment intent ID must not be empty")
	}
	row := pool.QueryRow(ctx,
		`SELECT `+agentTopupColumns+`
		 FROM agent_topups
		 WHERE stripe_payment_intent_id = $1 AND direction = 'CREDIT'
		 LIMIT 1`,
		stripePaymentIntentID,
	)
	t, err := scanAgentTopup(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentTopup{}, err
		}
		return AgentTopup{}, fmt.Errorf("get agent topup by stripe PI: %w", err)
	}
	return t, nil
}

// ListAgentTopupsByOperator returns the operator's billing history (both
// CREDIT topups and DEBIT refunds) in newest-first order, paginated by
// created_at cursor. Mirrors the GetMerchantTransactionsPaginated pattern in
// queries.go: fetches limit+1 to peek-ahead for nextCursor; returns nil
// cursor when there are no more pages.
func ListAgentTopupsByOperator(ctx context.Context, pool *pgxpool.Pool, agentOperatorID string, limit int, cursor *time.Time) ([]AgentTopup, *time.Time, error) {
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
		`SELECT `+agentTopupColumns+`
		 FROM agent_topups
		 WHERE agent_operator_id = $1%s
		 ORDER BY created_at DESC
		 LIMIT $%d`,
		cursorWhere, limitParam,
	)

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("query agent topups: %w", err)
	}
	defer rows.Close()

	var topups []AgentTopup
	for rows.Next() {
		t, err := scanAgentTopup(rows)
		if err != nil {
			return nil, nil, fmt.Errorf("scan agent topup: %w", err)
		}
		topups = append(topups, t)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate agent topups: %w", err)
	}

	// Peek-ahead trick: if we got limit+1 rows, trim and set nextCursor.
	var nextCursor *time.Time
	if len(topups) > limit {
		topups = topups[:limit]
		last := topups[len(topups)-1].CreatedAt
		nextCursor = &last
	}

	return topups, nextCursor, nil
}
