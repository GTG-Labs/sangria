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
		ON CONFLICT (agent_operator_id, idempotency_key) DO NOTHING
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
	// Mirror chk_agent_topups_direction_matches_source: DEBIT ⟺ source='stripe_refund'.
	if p.Direction == Debit && p.Source != AgentTopupSourceStripeRefund {
		return fmt.Errorf("direction DEBIT requires source 'stripe_refund', got %q", p.Source)
	}
	if p.Direction == Credit && p.Source == AgentTopupSourceStripeRefund {
		return fmt.Errorf("source 'stripe_refund' requires direction DEBIT, got %q", p.Direction)
	}
	// Mirror chk_agent_topups_stripe_pi_required: stripe_* sources need a PI.
	switch p.Source {
	case AgentTopupSourceStripeCard, AgentTopupSourceStripeACH, AgentTopupSourceStripeRefund:
		if p.StripePaymentIntentID == nil || strings.TrimSpace(*p.StripePaymentIntentID) == "" {
			return fmt.Errorf("source %q requires stripe_payment_intent_id", p.Source)
		}
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

// CompleteStripeAgentTopup finalizes a pending stripe_card topup by writing
// the matching ledger entries (DEBIT system Stripe Clearing asset, CREDIT
// the operator's paid-credits liability) and flipping the topup row to
// completed — all inside one transaction so Stripe's at-least-once webhook
// delivery can't double-credit. Lookup is by PaymentIntent ID, the field the
// webhook payload carries.
//
// Status outcomes:
//   - already completed → returns the existing row, no ledger write.
//   - already failed    → returns ErrAgentTopupAlreadyFailed; the webhook
//     handler returns 200 since the event has been processed.
//   - pending           → writes ledger, marks completed, returns updated row.
//   - missing           → returns ErrAgentTopupNotFound.
func CompleteStripeAgentTopup(ctx context.Context, pool *pgxpool.Pool, stripePaymentIntentID string) (AgentTopup, error) {
	if strings.TrimSpace(stripePaymentIntentID) == "" {
		return AgentTopup{}, fmt.Errorf("stripe payment intent ID must not be empty")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return AgentTopup{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the topup row. The CREDIT direction guard is defensive — refund
	// rows live under the same stripe_payment_intent_id but with DEBIT
	// direction and aren't completable by this function.
	row := tx.QueryRow(ctx,
		`SELECT `+agentTopupColumns+`
		 FROM agent_topups
		 WHERE stripe_payment_intent_id = $1 AND direction = 'CREDIT'
		 FOR UPDATE`,
		stripePaymentIntentID,
	)
	t, err := scanAgentTopup(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentTopup{}, ErrAgentTopupNotFound
		}
		return AgentTopup{}, fmt.Errorf("lock agent topup: %w", err)
	}

	switch t.Status {
	case AgentTopupStatusCompleted:
		if err := tx.Commit(ctx); err != nil {
			return AgentTopup{}, fmt.Errorf("commit: %w", err)
		}
		return t, nil
	case AgentTopupStatusFailed:
		return AgentTopup{}, ErrAgentTopupAlreadyFailed
	case AgentTopupStatusPending:
		// fall through
	default:
		return AgentTopup{}, fmt.Errorf("unexpected agent topup status: %s", t.Status)
	}

	// Need the operator's organization_id to look up the per-org liability
	// account. operator-row read is fine; CreateAgentOperator already ran for
	// the org before any topup could be inserted.
	var orgID string
	err = tx.QueryRow(ctx,
		`SELECT organization_id FROM agent_operators WHERE id = $1`,
		t.AgentOperatorID,
	).Scan(&orgID)
	if err != nil {
		return AgentTopup{}, fmt.Errorf("read operator org: %w", err)
	}

	// Make sure both per-operator credit accounts exist before we touch the
	// ledger. CreateAgentOperator already runs this on operator creation; we
	// repeat it here so a topup against a legacy operator (created before
	// the agent-credits accounts were introduced) can self-heal.
	_, paidAcct, err := getOrCreateAgentCreditsAccountsInTx(ctx, tx, orgID)
	if err != nil {
		return AgentTopup{}, fmt.Errorf("ensure agent credit accounts: %w", err)
	}
	stripeAcct, err := GetSystemAccount(ctx, tx, SystemAccountStripeClearing, USD)
	if err != nil {
		return AgentTopup{}, fmt.Errorf("lookup stripe clearing system account: %w", err)
	}

	// Ledger idempotency key derives from the topup PK — guarantees that
	// two concurrent webhook deliveries for the same PI converge on the
	// same transactions row even if the FOR UPDATE-on-the-topup somehow
	// raced.
	ledgerKey := "stripe-topup-" + t.ID
	entries, err := insertTransactionInTx(ctx, tx, ledgerKey, []LedgerLine{
		{Currency: USD, Amount: t.AmountCreditsMicrounits, Direction: Debit, AccountID: stripeAcct.ID},
		{Currency: USD, Amount: t.AmountCreditsMicrounits, Direction: Credit, AccountID: paidAcct.ID},
	})
	if err != nil {
		return AgentTopup{}, fmt.Errorf("write topup ledger entries: %w", err)
	}
	if len(entries) == 0 {
		return AgentTopup{}, fmt.Errorf("topup ledger write returned no entries")
	}

	row = tx.QueryRow(ctx,
		`UPDATE agent_topups
		 SET status = 'completed', completed_at = NOW(), ledger_transaction_id = $2
		 WHERE id = $1 AND status = 'pending'
		 RETURNING `+agentTopupColumns,
		t.ID, entries[0].TransactionID,
	)
	completed, err := scanAgentTopup(row)
	if err != nil {
		return AgentTopup{}, fmt.Errorf("mark agent topup completed: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return AgentTopup{}, fmt.Errorf("commit: %w", err)
	}
	return completed, nil
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
