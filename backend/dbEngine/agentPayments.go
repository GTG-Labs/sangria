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

// agentPaymentColumns is the canonical SELECT / RETURNING column list for
// agent_payments rows. Keeps SQL and Scan() target order in lockstep.
const agentPaymentColumns = `id, idempotency_key, api_key_id, merchant_url_or_host, merchant_pay_to_address,
	network, scheme, max_amount_microunits, settlement_amount_microunits, platform_fee_microunits,
	valid_before, payment_signature_b64, status, tx_hash, ledger_transaction_id,
	failure_code, failure_message, metadata,
	created_at, confirmed_at, failed_at, unresolved_at`

// validPaymentSchemes enumerates the scheme values accepted at the Go layer.
// Mirrors paymentSchemeEnum in the schema; DB enum is the final guarantee.
var validPaymentSchemes = map[PaymentScheme]bool{
	PaymentSchemeExact: true,
	PaymentSchemeUpto:  true,
}

// scanAgentPayment scans a row produced by SELECT agentPaymentColumns.
func scanAgentPayment(row pgx.Row) (AgentPayment, error) {
	var p AgentPayment
	err := row.Scan(
		&p.ID, &p.IdempotencyKey, &p.APIKeyID, &p.MerchantURLOrHost, &p.MerchantPayToAddress,
		&p.Network, &p.Scheme, &p.MaxAmountMicrounits, &p.SettlementAmountMicrounits, &p.PlatformFeeMicrounits,
		&p.ValidBefore, &p.PaymentSignatureB64, &p.Status, &p.TxHash, &p.LedgerTransactionID,
		&p.FailureCode, &p.FailureMessage, &p.Metadata,
		&p.CreatedAt, &p.ConfirmedAt, &p.FailedAt, &p.UnresolvedAt,
	)
	return p, err
}

// CreateAgentPaymentParams holds the inputs for CreateAgentPayment. The caller
// (the /v1/agent/sign handler) assembles these from the SDK request + the
// CDP signing output + the merchant's PAYMENT-REQUIRED challenge.
type CreateAgentPaymentParams struct {
	IdempotencyKey       string          // client-supplied UUIDv4 from SDK
	APIKeyID             string          // from the authenticated key
	AgentOperatorID      string          // for FOR UPDATE lock + balance check
	MerchantURLOrHost    string
	MerchantPayToAddress string
	Network              string // CAIP-2 chain identifier
	Scheme               PaymentScheme
	MaxAmountMicrounits  int64
	UpperBoundCost       int64 // MaxAmount + worst-case fee; balance must cover this
	ValidBefore          time.Time
	PaymentSignatureB64  string
	Metadata             json.RawMessage // operator passthrough; nullable
}

// CreateAgentPayment atomically: (1) acquires a FOR UPDATE lock on the
// operator row, (2) recomputes the operator's credit balance under the lock,
// (3) verifies balance >= UpperBoundCost, (4) inserts the pending payment row.
// Returns ErrInsufficientOperatorBalance if the balance check fails.
// Idempotent on idempotency_key: a duplicate retry returns the existing row.
//
// The operator-row lock serializes concurrent sign requests for the same
// operator so two parallel requests can't both pass the balance check and
// double-spend. Other operators' requests are unaffected.
func CreateAgentPayment(ctx context.Context, pool *pgxpool.Pool, params CreateAgentPaymentParams) (AgentPayment, error) {
	if err := validateCreateAgentPaymentParams(params); err != nil {
		return AgentPayment{}, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) // safe no-op once Commit fires

	// Lock the operator row and pick up its organization_id for the balance query.
	var orgID string
	err = tx.QueryRow(ctx,
		`SELECT organization_id FROM agent_operators WHERE id = $1 FOR UPDATE`,
		params.AgentOperatorID,
	).Scan(&orgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentPayment{}, ErrAgentOperatorNotFound
		}
		return AgentPayment{}, fmt.Errorf("lock agent operator: %w", err)
	}

	// Recompute balance under the lock.
	trial, paid, err := GetAgentCreditsBalances(ctx, tx, orgID)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("compute balance: %w", err)
	}

	// Also subtract the sum of any currently-pending payments across all of this
	// operator's keys. Pending rows don't write ledger entries until confirm, so
	// the ledger-based balance above would otherwise over-report the available
	// amount and let concurrent sign requests both pass even when the operator
	// can't actually afford both. The FOR UPDATE lock above serializes this read
	// across concurrent CreateAgentPayment calls for the same operator.
	//
	// Uses max_amount_microunits since UpperBoundCost isn't stored per row; for
	// V0 with no platform fee they're equal, and using the smaller value is
	// conservative-but-acceptable when fees do land later (caller may pass a
	// pre-check that then fails at confirm, vs the opposite which would silently
	// over-spend). Orphan pending rows (signed but never confirmed/failed) hold
	// balance until cleaned up — sweeper is a V1.x gap shared with order expiry.
	var pendingHold int64
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(p.max_amount_microunits), 0)
		FROM agent_payments p
		JOIN agent_api_keys k ON k.id = p.api_key_id
		WHERE k.agent_operator_id = $1 AND p.status = 'pending'
	`, params.AgentOperatorID).Scan(&pendingHold)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("compute pending hold: %w", err)
	}

	available := trial + paid - pendingHold
	if available < params.UpperBoundCost {
		return AgentPayment{}, fmt.Errorf("%w: have %d, need %d (pending hold: %d)",
			ErrInsufficientOperatorBalance, available, params.UpperBoundCost, pendingHold)
	}

	// Normalize Metadata: nil/empty → NULL in the DB.
	var metadataArg any
	if len(params.Metadata) > 0 {
		metadataArg = params.Metadata
	}

	// Insert pending row. Idempotency-key unique catches duplicate retries.
	row := tx.QueryRow(ctx,
		`INSERT INTO agent_payments (
			idempotency_key, api_key_id, merchant_url_or_host, merchant_pay_to_address,
			network, scheme, max_amount_microunits, valid_before, payment_signature_b64,
			status, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING `+agentPaymentColumns,
		params.IdempotencyKey, params.APIKeyID, params.MerchantURLOrHost, params.MerchantPayToAddress,
		params.Network, params.Scheme, params.MaxAmountMicrounits, params.ValidBefore, params.PaymentSignatureB64,
		metadataArg,
	)
	p, err := scanAgentPayment(row)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return AgentPayment{}, fmt.Errorf("insert agent payment: %w", err)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		// Idempotency-key conflict — return the existing row.
		row = tx.QueryRow(ctx,
			`SELECT `+agentPaymentColumns+` FROM agent_payments WHERE idempotency_key = $1`,
			params.IdempotencyKey,
		)
		p, err = scanAgentPayment(row)
		if err != nil {
			return AgentPayment{}, fmt.Errorf("read existing agent payment after conflict: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return AgentPayment{}, fmt.Errorf("commit: %w", err)
	}
	return p, nil
}

func validateCreateAgentPaymentParams(p CreateAgentPaymentParams) error {
	if strings.TrimSpace(p.IdempotencyKey) == "" {
		return fmt.Errorf("idempotency key must not be empty")
	}
	if strings.TrimSpace(p.APIKeyID) == "" {
		return fmt.Errorf("api key ID must not be empty")
	}
	if strings.TrimSpace(p.AgentOperatorID) == "" {
		return fmt.Errorf("agent operator ID must not be empty")
	}
	if strings.TrimSpace(p.MerchantURLOrHost) == "" {
		return fmt.Errorf("merchant URL or host must not be empty")
	}
	if strings.TrimSpace(p.MerchantPayToAddress) == "" {
		return fmt.Errorf("merchant pay-to address must not be empty")
	}
	if strings.TrimSpace(p.Network) == "" {
		return fmt.Errorf("network must not be empty")
	}
	if !validPaymentSchemes[p.Scheme] {
		return fmt.Errorf("invalid scheme %q (must be exact or upto)", p.Scheme)
	}
	if p.MaxAmountMicrounits <= 0 {
		return fmt.Errorf("max_amount_microunits must be positive, got %d", p.MaxAmountMicrounits)
	}
	if p.UpperBoundCost < p.MaxAmountMicrounits {
		return fmt.Errorf("upper_bound_cost (%d) must be >= max_amount_microunits (%d)", p.UpperBoundCost, p.MaxAmountMicrounits)
	}
	if strings.TrimSpace(p.PaymentSignatureB64) == "" {
		return fmt.Errorf("payment signature must not be empty")
	}
	if p.ValidBefore.IsZero() {
		return fmt.Errorf("valid_before must be set")
	}
	if !p.ValidBefore.After(time.Now().UTC()) {
		return fmt.Errorf("valid_before must be in the future, got %s", p.ValidBefore.Format(time.RFC3339))
	}
	return nil
}

// GetAgentPaymentByID returns the payment row with the given ID. Returns
// pgx.ErrNoRows if no row matches — caller wraps as appropriate.
func GetAgentPaymentByID(ctx context.Context, pool *pgxpool.Pool, paymentID string) (AgentPayment, error) {
	if strings.TrimSpace(paymentID) == "" {
		return AgentPayment{}, fmt.Errorf("payment ID must not be empty")
	}
	row := pool.QueryRow(ctx,
		`SELECT `+agentPaymentColumns+` FROM agent_payments WHERE id = $1`,
		paymentID,
	)
	p, err := scanAgentPayment(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentPayment{}, err
		}
		return AgentPayment{}, fmt.Errorf("get agent payment by ID: %w", err)
	}
	return p, nil
}

// GetAgentPaymentByIdempotencyKey returns the payment row matching the given
// client-supplied idempotency key. Used by /v1/agent/sign to short-circuit
// duplicate retries before doing any sign work. Returns pgx.ErrNoRows if no
// row matches.
func GetAgentPaymentByIdempotencyKey(ctx context.Context, pool *pgxpool.Pool, key string) (AgentPayment, error) {
	if strings.TrimSpace(key) == "" {
		return AgentPayment{}, fmt.Errorf("idempotency key must not be empty")
	}
	row := pool.QueryRow(ctx,
		`SELECT `+agentPaymentColumns+` FROM agent_payments WHERE idempotency_key = $1`,
		key,
	)
	p, err := scanAgentPayment(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentPayment{}, err
		}
		return AgentPayment{}, fmt.Errorf("get agent payment by idempotency key: %w", err)
	}
	return p, nil
}

// ConfirmAgentPaymentParams holds the inputs for ConfirmAgentPayment.
// LedgerLines are constructed by the caller (the /v1/agent/confirm or
// /v1/agent/reconcile handler) based on the actual settlement amount + fee
// and Sangria's cross-currency accounting model. dbengine writes them via
// insertTransactionInTx but does not interpret them.
type ConfirmAgentPaymentParams struct {
	PaymentID                  string
	TxHash                     string
	SettlementAmountMicrounits int64
	PlatformFeeMicrounits      int64
	LedgerIdempotencyKey       string // caller-derived (e.g. "payment-confirm-<paymentID>")
	LedgerLines                []LedgerLine
}

// ConfirmAgentPayment atomically: (1) locks the payment row, (2) verifies it's
// in a confirmable state (pending or unresolved), (3) writes the ledger entries
// via insertTransactionInTx, (4) UPDATEs the payment row to confirmed with all
// confirm-required fields. The whole thing commits together or rolls back.
//
// Idempotent: if the row is already confirmed, returns the existing row with
// no ledger write and no error. Returns ErrIntentNotPending if the row is in
// 'failed' state (terminal state can't be re-confirmed).
//
// The chk_agent_payments_confirmed_fields_required CHECK enforces that all
// five confirm fields land together — defense in depth against a half-written
// confirm somehow slipping past.
func ConfirmAgentPayment(ctx context.Context, pool *pgxpool.Pool, params ConfirmAgentPaymentParams) (AgentPayment, error) {
	if err := validateConfirmAgentPaymentParams(params); err != nil {
		return AgentPayment{}, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the payment row and inspect its current status.
	row := tx.QueryRow(ctx,
		`SELECT `+agentPaymentColumns+` FROM agent_payments WHERE id = $1 FOR UPDATE`,
		params.PaymentID,
	)
	p, err := scanAgentPayment(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentPayment{}, fmt.Errorf("agent payment %s not found", params.PaymentID)
		}
		return AgentPayment{}, fmt.Errorf("lock agent payment: %w", err)
	}

	switch p.Status {
	case AgentPaymentStatusConfirmed:
		// Idempotent return — no ledger write, just hand back the existing row.
		if err := tx.Commit(ctx); err != nil {
			return AgentPayment{}, fmt.Errorf("commit: %w", err)
		}
		return p, nil
	case AgentPaymentStatusFailed:
		return AgentPayment{}, fmt.Errorf("%w: payment %s is in failed state", ErrIntentNotPending, params.PaymentID)
	case AgentPaymentStatusPending, AgentPaymentStatusUnresolved:
		// proceed with confirm
	default:
		return AgentPayment{}, fmt.Errorf("unexpected agent payment status: %s", p.Status)
	}

	// Write the ledger entries (validates zero-net per currency).
	entries, err := insertTransactionInTx(ctx, tx, params.LedgerIdempotencyKey, params.LedgerLines)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("write confirm ledger entries: %w", err)
	}
	if len(entries) == 0 {
		return AgentPayment{}, fmt.Errorf("confirm ledger write returned no entries")
	}
	ledgerTxID := entries[0].TransactionID

	// UPDATE the payment row with all confirm fields atomically.
	row = tx.QueryRow(ctx,
		`UPDATE agent_payments SET
			status = 'confirmed',
			tx_hash = $2,
			settlement_amount_microunits = $3,
			platform_fee_microunits = $4,
			ledger_transaction_id = $5,
			confirmed_at = NOW()
		 WHERE id = $1
		 RETURNING `+agentPaymentColumns,
		params.PaymentID, params.TxHash,
		params.SettlementAmountMicrounits, params.PlatformFeeMicrounits, ledgerTxID,
	)
	confirmed, err := scanAgentPayment(row)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("update agent payment to confirmed: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return AgentPayment{}, fmt.Errorf("commit: %w", err)
	}
	return confirmed, nil
}

func validateConfirmAgentPaymentParams(p ConfirmAgentPaymentParams) error {
	if strings.TrimSpace(p.PaymentID) == "" {
		return fmt.Errorf("payment ID must not be empty")
	}
	if strings.TrimSpace(p.TxHash) == "" {
		return fmt.Errorf("tx hash must not be empty")
	}
	if p.SettlementAmountMicrounits <= 0 {
		return fmt.Errorf("settlement_amount_microunits must be positive, got %d", p.SettlementAmountMicrounits)
	}
	if p.PlatformFeeMicrounits < 0 {
		return fmt.Errorf("platform_fee_microunits must be non-negative, got %d", p.PlatformFeeMicrounits)
	}
	if strings.TrimSpace(p.LedgerIdempotencyKey) == "" {
		return fmt.Errorf("ledger idempotency key must not be empty")
	}
	if len(p.LedgerLines) == 0 {
		return fmt.Errorf("ledger lines must not be empty")
	}
	return nil
}

// FailAgentPayment transitions a pending or unresolved payment to failed.
// Idempotent: if already failed, returns the existing row with no error.
// Returns ErrIntentAlreadyConfirmed if the row is in 'confirmed' state — a
// caller trying to fail a confirmed payment is a programmer bug worth
// surfacing loudly.
func FailAgentPayment(ctx context.Context, pool *pgxpool.Pool, paymentID, failureCode, failureMessage string) (AgentPayment, error) {
	if strings.TrimSpace(paymentID) == "" {
		return AgentPayment{}, fmt.Errorf("payment ID must not be empty")
	}
	if strings.TrimSpace(failureCode) == "" {
		return AgentPayment{}, fmt.Errorf("failure code must not be empty")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	row := tx.QueryRow(ctx,
		`SELECT `+agentPaymentColumns+` FROM agent_payments WHERE id = $1 FOR UPDATE`,
		paymentID,
	)
	p, err := scanAgentPayment(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentPayment{}, fmt.Errorf("agent payment %s not found", paymentID)
		}
		return AgentPayment{}, fmt.Errorf("lock agent payment: %w", err)
	}

	switch p.Status {
	case AgentPaymentStatusFailed:
		if err := tx.Commit(ctx); err != nil {
			return AgentPayment{}, fmt.Errorf("commit: %w", err)
		}
		return p, nil
	case AgentPaymentStatusConfirmed:
		return AgentPayment{}, fmt.Errorf("%w: cannot fail confirmed payment %s", ErrIntentAlreadyConfirmed, paymentID)
	case AgentPaymentStatusPending, AgentPaymentStatusUnresolved:
		// proceed
	default:
		return AgentPayment{}, fmt.Errorf("unexpected agent payment status: %s", p.Status)
	}

	row = tx.QueryRow(ctx,
		`UPDATE agent_payments SET
			status = 'failed',
			failure_code = $2,
			failure_message = $3,
			failed_at = NOW()
		 WHERE id = $1
		 RETURNING `+agentPaymentColumns,
		paymentID, failureCode, failureMessage,
	)
	failed, err := scanAgentPayment(row)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("update agent payment to failed: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return AgentPayment{}, fmt.Errorf("commit: %w", err)
	}
	return failed, nil
}

// MarkAgentPaymentUnresolved transitions a pending payment to unresolved.
// Idempotent: if already unresolved, returns the existing row with no error.
// Returns ErrIntentNotPending if the row is in a terminal state
// (confirmed/failed) — an unresolved transition from a terminal state is a
// programmer bug.
func MarkAgentPaymentUnresolved(ctx context.Context, pool *pgxpool.Pool, paymentID string) (AgentPayment, error) {
	if strings.TrimSpace(paymentID) == "" {
		return AgentPayment{}, fmt.Errorf("payment ID must not be empty")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	row := tx.QueryRow(ctx,
		`SELECT `+agentPaymentColumns+` FROM agent_payments WHERE id = $1 FOR UPDATE`,
		paymentID,
	)
	p, err := scanAgentPayment(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentPayment{}, fmt.Errorf("agent payment %s not found", paymentID)
		}
		return AgentPayment{}, fmt.Errorf("lock agent payment: %w", err)
	}

	switch p.Status {
	case AgentPaymentStatusUnresolved:
		if err := tx.Commit(ctx); err != nil {
			return AgentPayment{}, fmt.Errorf("commit: %w", err)
		}
		return p, nil
	case AgentPaymentStatusConfirmed, AgentPaymentStatusFailed:
		return AgentPayment{}, fmt.Errorf("%w: cannot mark %s payment %s as unresolved", ErrIntentNotPending, p.Status, paymentID)
	case AgentPaymentStatusPending:
		// proceed
	default:
		return AgentPayment{}, fmt.Errorf("unexpected agent payment status: %s", p.Status)
	}

	row = tx.QueryRow(ctx,
		`UPDATE agent_payments SET
			status = 'unresolved',
			unresolved_at = NOW()
		 WHERE id = $1
		 RETURNING `+agentPaymentColumns,
		paymentID,
	)
	unresolved, err := scanAgentPayment(row)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("update agent payment to unresolved: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return AgentPayment{}, fmt.Errorf("commit: %w", err)
	}
	return unresolved, nil
}

// ListAgentPaymentsByAPIKey returns the API key's payment history in
// newest-first order, paginated by created_at cursor. Mirrors the
// GetMerchantTransactionsPaginated pattern in queries.go: fetches limit+1 to
// peek-ahead for nextCursor; returns nil cursor when there are no more pages.
func ListAgentPaymentsByAPIKey(ctx context.Context, pool *pgxpool.Pool, apiKeyID string, limit int, cursor *time.Time) ([]AgentPayment, *time.Time, error) {
	if strings.TrimSpace(apiKeyID) == "" {
		return nil, nil, fmt.Errorf("api key ID must not be empty")
	}
	if limit <= 0 {
		return nil, nil, fmt.Errorf("limit must be positive, got %d", limit)
	}

	args := []any{apiKeyID}
	cursorWhere := ""
	if cursor != nil {
		cursorWhere = " AND created_at < $2"
		args = append(args, *cursor)
	}
	args = append(args, limit+1)
	limitParam := len(args)

	query := fmt.Sprintf(
		`SELECT `+agentPaymentColumns+`
		 FROM agent_payments
		 WHERE api_key_id = $1%s
		 ORDER BY created_at DESC
		 LIMIT $%d`,
		cursorWhere, limitParam,
	)

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("query agent payments: %w", err)
	}
	defer rows.Close()

	var payments []AgentPayment
	for rows.Next() {
		p, err := scanAgentPayment(rows)
		if err != nil {
			return nil, nil, fmt.Errorf("scan agent payment: %w", err)
		}
		payments = append(payments, p)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate agent payments: %w", err)
	}

	var nextCursor *time.Time
	if len(payments) > limit {
		payments = payments[:limit]
		last := payments[len(payments)-1].CreatedAt
		nextCursor = &last
	}

	return payments, nextCursor, nil
}
