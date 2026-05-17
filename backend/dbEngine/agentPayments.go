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
const agentPaymentColumns = `id, idempotency_key, api_key_id, payment_type, merchant_url_or_host,
	merchant_pay_to_address, network, scheme,
	max_amount_microunits, settlement_amount_microunits, platform_fee_microunits,
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
// The four x402-only columns (merchant_pay_to_address, network, scheme,
// payment_signature_b64) are nullable in the DB; sangria-native rows store
// them as NULL. We decode through *string locals so NULL → "" on the Go
// struct, matching the empty-string-as-NULL convention used in the INSERT.
func scanAgentPayment(row pgx.Row) (AgentPayment, error) {
	var p AgentPayment
	var payToAddr, network, scheme, sigB64 *string
	err := row.Scan(
		&p.ID, &p.IdempotencyKey, &p.APIKeyID, &p.PaymentType, &p.MerchantURLOrHost,
		&payToAddr, &network, &scheme,
		&p.MaxAmountMicrounits, &p.SettlementAmountMicrounits, &p.PlatformFeeMicrounits,
		&p.ValidBefore, &sigB64, &p.Status, &p.TxHash, &p.LedgerTransactionID,
		&p.FailureCode, &p.FailureMessage, &p.Metadata,
		&p.CreatedAt, &p.ConfirmedAt, &p.FailedAt, &p.UnresolvedAt,
	)
	if err != nil {
		return p, err
	}
	if payToAddr != nil {
		p.MerchantPayToAddress = *payToAddr
	}
	if network != nil {
		p.Network = *network
	}
	if scheme != nil {
		p.Scheme = PaymentScheme(*scheme)
	}
	if sigB64 != nil {
		p.PaymentSignatureB64 = *sigB64
	}
	return p, nil
}

// CreateAgentPaymentParams holds the inputs for CreateAgentPayment. The caller
// assembles these from the SDK request + protocol-specific material (CDP
// signing output for x402; just the order context for sangria-native).
//
// PaymentType discriminates which subset of fields below must be populated:
//   - "x402": MerchantPayToAddress, Network, Scheme, PaymentSignatureB64 all
//     required (non-empty). Validator enforces.
//   - "sangria_native": those four MUST be empty. Validator enforces; the DB
//     CHECK chk_agent_payments_native_fields is the source of truth.
//
// The INSERT translates empty strings → NULL via the metadataArg pattern so
// callers don't have to deal with *string. Convention: pass "" for fields
// the protocol doesn't use.
type CreateAgentPaymentParams struct {
	IdempotencyKey       string           // client-supplied UUIDv4 from SDK
	APIKeyID             string           // from the authenticated key
	AgentOperatorID      string           // for FOR UPDATE lock + balance check
	PaymentType          AgentPaymentType // "x402" | "sangria_native"
	MerchantURLOrHost    string
	MerchantPayToAddress string        // x402 only — "" for sangria_native
	Network              string        // x402 only — "" for sangria_native (CAIP-2 chain ID when set)
	Scheme               PaymentScheme // x402 only — "" for sangria_native
	MaxAmountMicrounits  int64
	UpperBoundCost       int64 // MaxAmount + worst-case fee; balance must cover this
	ValidBefore          time.Time
	PaymentSignatureB64  string          // x402 only — "" for sangria_native
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
	// Uses max_amount_microunits as a proxy for the upper-bound cost. This is
	// EXACT only while platform fees are zero (the case here — platform-fee
	// computation is unimplemented and the column doesn't exist on
	// agent_payments). With non-zero fees, this SUM would UNDER-COUNT the
	// pending hold, and ConfirmAgentPayment performs no balance check to catch
	// the overspend at confirm time — the overspend would land silently.
	// Supporting non-zero fees requires either persisting upper_bound_cost as a
	// column on agent_payments, or adding a balance check inside
	// ConfirmAgentPayment that fails the payment if it would push the operator
	// negative. Orphan pending rows (signed but never confirmed/failed) hold
	// balance until cleaned up; sweeper not yet implemented.
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

	// Empty-string-as-NULL for the four x402-only columns. Sangria-native
	// callers pass "" for these; the paired DB CHECK constraints enforce that
	// NULL is the only allowed value for those rows. Same pattern as
	// metadataArg above.
	emptyToNil := func(s string) any {
		if s == "" {
			return nil
		}
		return s
	}
	payToAddrArg := emptyToNil(params.MerchantPayToAddress)
	networkArg := emptyToNil(params.Network)
	schemeArg := emptyToNil(string(params.Scheme))
	sigB64Arg := emptyToNil(params.PaymentSignatureB64)

	// Insert pending row. Idempotency-key unique catches duplicate retries.
	row := tx.QueryRow(ctx,
		`INSERT INTO agent_payments (
			idempotency_key, api_key_id, payment_type, merchant_url_or_host,
			merchant_pay_to_address, network, scheme,
			max_amount_microunits, valid_before, payment_signature_b64,
			status, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING `+agentPaymentColumns,
		params.IdempotencyKey, params.APIKeyID, params.PaymentType, params.MerchantURLOrHost,
		payToAddrArg, networkArg, schemeArg,
		params.MaxAmountMicrounits, params.ValidBefore, sigB64Arg,
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
	// Universal fields (both protocols)
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
	if p.MaxAmountMicrounits <= 0 {
		return fmt.Errorf("max_amount_microunits must be positive, got %d", p.MaxAmountMicrounits)
	}
	if p.UpperBoundCost < p.MaxAmountMicrounits {
		return fmt.Errorf("upper_bound_cost (%d) must be >= max_amount_microunits (%d)", p.UpperBoundCost, p.MaxAmountMicrounits)
	}
	if p.ValidBefore.IsZero() {
		return fmt.Errorf("valid_before must be set")
	}
	if !p.ValidBefore.After(time.Now().UTC()) {
		return fmt.Errorf("valid_before must be in the future, got %s", p.ValidBefore.Format(time.RFC3339))
	}

	// Protocol-specific fields. The DB CHECKs are the source of truth — these
	// Go-side branches surface a clean error before pgx bubbles a constraint
	// violation from deep in the call stack.
	switch p.PaymentType {
	case AgentPaymentTypeX402:
		if strings.TrimSpace(p.MerchantPayToAddress) == "" {
			return fmt.Errorf("x402: merchant pay-to address must not be empty")
		}
		if strings.TrimSpace(p.Network) == "" {
			return fmt.Errorf("x402: network must not be empty")
		}
		if !validPaymentSchemes[p.Scheme] {
			return fmt.Errorf("x402: invalid scheme %q (must be exact or upto)", p.Scheme)
		}
		if strings.TrimSpace(p.PaymentSignatureB64) == "" {
			return fmt.Errorf("x402: payment signature must not be empty")
		}
	case AgentPaymentTypeSangriaNative:
		if p.MerchantPayToAddress != "" {
			return fmt.Errorf("sangria_native: merchant pay-to address must be empty (got %q)", p.MerchantPayToAddress)
		}
		if p.Network != "" {
			return fmt.Errorf("sangria_native: network must be empty (got %q)", p.Network)
		}
		if p.Scheme != "" {
			return fmt.Errorf("sangria_native: scheme must be empty (got %q)", p.Scheme)
		}
		if p.PaymentSignatureB64 != "" {
			return fmt.Errorf("sangria_native: payment signature must be empty")
		}
	default:
		return fmt.Errorf("invalid payment_type %q (must be x402 or sangria_native)", p.PaymentType)
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
//
// TODO(defense-in-depth gap, x402): validateConfirmAgentPaymentParams only
// checks len(LedgerLines) > 0; nothing verifies that DEBIT entries sum to
// SettlementAmount + PlatformFee. A caller bug could record settlement=$10
// on the payment row while debiting $1 (or $100) from the operator —
// insertTransactionInTx's zero-net-per-currency check wouldn't catch that
// because it only validates internal balance, not the tie back to the
// recorded amount. The sangria-native confirm path (ConfirmSangriaNativePayment)
// closes this with two defense-in-depth asserts inside the helper because it
// owns its own line construction; for x402 the fix is non-trivial because the
// cross-currency model means the validator needs operator-account-ID context
// this function doesn't currently take (the right "operator-side DEBITs"
// would have to be identified across USDC↔USD conversion entries). Punt
// until the x402 path gets a broader audit; sangria-native /v1/buy is the
// only confirm flow shipping in this PR.
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

// ---------------------------------------------------------------------------
// sangria-native confirm flow
// ---------------------------------------------------------------------------

// splitTrialPaid computes how to split a totalCost spend between the operator's
// Trial and Paid credit accounts. Trial drains first (spend-order rule); if it
// doesn't cover the full cost, the remainder comes from Paid. Always returns
// non-negative parts that sum to totalCost when trialBalance >= 0.
//
// MUST be called inside the operator-row FOR UPDATE lock — see
// ConfirmSangriaNativePayment for the race discussion.
func splitTrialPaid(trialBalance, totalCost int64) (trialPart, paidPart int64) {
	if trialBalance >= totalCost {
		return totalCost, 0
	}
	if trialBalance < 0 {
		// Negative trial means a prior bug already over-drained the account.
		// Refuse to compound it: treat trial as zero and bill the whole cost
		// to Paid. ConfirmSangriaNativePayment's defense-in-depth asserts
		// will catch the resulting violation and refuse the write.
		return 0, totalCost
	}
	return trialBalance, totalCost - trialBalance
}

// ConfirmSangriaNativePaymentParams holds the inputs for ConfirmSangriaNativePayment.
// Caller provides the totals + identifiers; the dbEngine helper owns the lock,
// balance read, split, ledger-line construction, and atomic ledger+status write.
type ConfirmSangriaNativePaymentParams struct {
	PaymentID                  string
	AgentOperatorID            string // for FOR UPDATE lock; organization_id is derived under the lock
	SettlementAmountMicrounits int64  // = order.QuoteAmountMicrounits in V1
	PlatformFeeMicrounits      int64  // = 0 in V1 until platform-fee accounting lands
	LedgerIdempotencyKey       string // deterministic, e.g. "payment-confirm-<paymentID>"
}

// ConfirmSangriaNativePayment atomically:
//  1. Locks the payment row, verifies it's pending and sangria_native.
//  2. Locks the operator row FOR UPDATE (serializes concurrent confirms for
//     the same operator — closes the trial/paid split race).
//  3. Reads trial balance under the lock.
//  4. Computes splitTrialPaid(trialBalance, totalCost) and asserts the parts
//     sum to totalCost (defense-in-depth #1).
//  5. Looks up the trial / paid / settlement-payable account IDs.
//  6. Builds 2-or-3 ledger lines (DEBIT Trial, optional DEBIT Paid when
//     trial doesn't cover, CREDIT Merchant Settlement Payable for totalCost).
//  7. Asserts the operator-side DEBITs sum to settlement+fee (defense-in-depth
//     #2) — catches refactor bugs that break line construction.
//  8. Writes the ledger entries via insertTransactionInTx (which enforces
//     zero-net per currency).
//  9. UPDATEs the payment row to confirmed with all confirm fields.
//
// Idempotent: re-call on an already-confirmed payment returns the existing
// row with no ledger write. Returns ErrIntentNotPending if the row is in
// 'failed' or 'unresolved' state (the latter doesn't apply to sangria-native
// flows but is treated as terminal for safety). Returns ErrWrongPaymentType
// if the row's payment_type isn't sangria_native — caller routed to the
// wrong confirm function.
func ConfirmSangriaNativePayment(ctx context.Context, pool *pgxpool.Pool, params ConfirmSangriaNativePaymentParams) (AgentPayment, error) {
	if err := validateConfirmSangriaNativePaymentParams(params); err != nil {
		return AgentPayment{}, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// 1. Lock the payment row, verify status + type.
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
		// Idempotent return — no ledger write, hand back the existing row.
		if err := tx.Commit(ctx); err != nil {
			return AgentPayment{}, fmt.Errorf("commit: %w", err)
		}
		return p, nil
	case AgentPaymentStatusFailed, AgentPaymentStatusUnresolved:
		return AgentPayment{}, fmt.Errorf("%w: payment %s is in %s state", ErrIntentNotPending, params.PaymentID, p.Status)
	case AgentPaymentStatusPending:
		// proceed
	default:
		return AgentPayment{}, fmt.Errorf("unexpected agent payment status: %s", p.Status)
	}

	if p.PaymentType != AgentPaymentTypeSangriaNative {
		return AgentPayment{}, fmt.Errorf("%w: payment %s has payment_type=%s", ErrWrongPaymentType, params.PaymentID, p.PaymentType)
	}

	// 2. Lock the operator row. Serializes concurrent confirms for the same
	// operator so the balance read + split below can't race with a sibling
	// confirm reading the same stale trial-balance snapshot. Derive org_id
	// from the operator (don't trust the caller) — mirrors CreateAgentPayment's
	// discipline.
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

	// 3. Read trial balance under the lock.
	trialBalance, _, err := GetAgentCreditsBalances(ctx, tx, orgID)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("read trial balance: %w", err)
	}

	totalCost := params.SettlementAmountMicrounits + params.PlatformFeeMicrounits

	// 4. Compute split + assert #1.
	trialPart, paidPart := splitTrialPaid(trialBalance, totalCost)
	if trialPart+paidPart != totalCost {
		// Tautological if splitTrialPaid is correct; catches one-character
		// bugs at the construction layer with a clean error rather than
		// letting them surface as a downstream zero-net failure inside
		// insertTransactionInTx.
		return AgentPayment{}, fmt.Errorf(
			"internal split error: trialPart(%d) + paidPart(%d) != totalCost(%d)",
			trialPart, paidPart, totalCost,
		)
	}

	// 5. Look up account IDs. Trial + Paid + Settlement Payable in one
	// org-scoped batch query (single round-trip).
	trialName := AgentCreditsTrialAccountName(orgID)
	paidName := AgentCreditsPaidAccountName(orgID)
	accountIDsByName, err := getOrgLiabilityAccountIDsByName(ctx, tx, orgID, []string{trialName, paidName})
	if err != nil {
		return AgentPayment{}, fmt.Errorf("lookup operator credit account IDs: %w", err)
	}
	trialID, ok := accountIDsByName[trialName]
	if !ok {
		return AgentPayment{}, fmt.Errorf("trial credit account %q not found for org %s", trialName, orgID)
	}
	paidID, ok := accountIDsByName[paidName]
	if !ok {
		return AgentPayment{}, fmt.Errorf("paid credit account %q not found for org %s", paidName, orgID)
	}
	settleID, err := MerchantSettlementPayableAccountID(ctx, tx)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("lookup Merchant Settlement Payable account: %w", err)
	}

	// 6. Build ledger lines. Omit the Paid debit when zero to keep the entry
	// list lean.
	lines := []LedgerLine{
		{Currency: USD, Amount: trialPart, Direction: Debit, AccountID: trialID},
	}
	if paidPart > 0 {
		lines = append(lines, LedgerLine{Currency: USD, Amount: paidPart, Direction: Debit, AccountID: paidID})
	}
	lines = append(lines, LedgerLine{Currency: USD, Amount: totalCost, Direction: Credit, AccountID: settleID})

	// 7. Assert #2: sum of operator-account DEBITs equals settlement+fee.
	// Closes the gap that ConfirmAgentPayment's existing validator leaves
	// open (no check tying recorded amounts to actual debits). Cheap pass
	// over a 2-or-3 element slice.
	var operatorDebits int64
	for _, l := range lines {
		if l.Direction == Debit && (l.AccountID == trialID || l.AccountID == paidID) {
			operatorDebits += l.Amount
		}
	}
	if operatorDebits != totalCost {
		return AgentPayment{}, fmt.Errorf(
			"internal ledger error: operator debits(%d) != settlement+fee(%d)",
			operatorDebits, totalCost,
		)
	}

	// Trial debits the trial account, which simultaneously offsets the
	// Trial Grants Issued expense booked when the operator was created.
	// Sangria's books stay balanced because the trial grant was already
	// CREDITed to Trial (raising liability we owe the operator); spending
	// it DEBITs that liability back down.

	// 8. Write the ledger entries.
	entries, err := insertTransactionInTx(ctx, tx, params.LedgerIdempotencyKey, lines)
	if err != nil {
		return AgentPayment{}, fmt.Errorf("write confirm ledger entries: %w", err)
	}
	if len(entries) == 0 {
		return AgentPayment{}, fmt.Errorf("confirm ledger write returned no entries")
	}
	ledgerTxID := entries[0].TransactionID

	// 9. UPDATE payment row to confirmed. tx_hash stays NULL for sangria-native
	// (paired chk_agent_payments_native_fields CHECK enforces this).
	row = tx.QueryRow(ctx,
		`UPDATE agent_payments SET
			status = 'confirmed',
			settlement_amount_microunits = $2,
			platform_fee_microunits = $3,
			ledger_transaction_id = $4,
			confirmed_at = NOW()
		 WHERE id = $1
		 RETURNING `+agentPaymentColumns,
		params.PaymentID,
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

func validateConfirmSangriaNativePaymentParams(p ConfirmSangriaNativePaymentParams) error {
	if strings.TrimSpace(p.PaymentID) == "" {
		return fmt.Errorf("payment ID must not be empty")
	}
	if strings.TrimSpace(p.AgentOperatorID) == "" {
		return fmt.Errorf("agent operator ID must not be empty")
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
	return nil
}

// getOrgLiabilityAccountIDsByName fetches account IDs for the given org-scoped
// LIABILITY/USD accounts by name in a single round-trip. Returns a map keyed by
// account name; missing names are absent from the map (caller decides whether
// that's an error). Accepts a pool or pgx.Tx via the queryer interface so it
// can compose inside an outer atomic transaction.
func getOrgLiabilityAccountIDsByName(ctx context.Context, q queryer, orgID string, names []string) (map[string]string, error) {
	if strings.TrimSpace(orgID) == "" {
		return nil, fmt.Errorf("organization ID must not be empty")
	}
	if len(names) == 0 {
		return map[string]string{}, nil
	}
	rows, err := q.Query(ctx,
		`SELECT name, id
		 FROM accounts
		 WHERE organization_id = $1
		   AND type = 'LIABILITY'
		   AND currency = 'USD'
		   AND name = ANY($2)`,
		orgID, names,
	)
	if err != nil {
		return nil, fmt.Errorf("query org liability accounts: %w", err)
	}
	defer rows.Close()
	out := make(map[string]string, len(names))
	for rows.Next() {
		var name, id string
		if err := rows.Scan(&name, &id); err != nil {
			return nil, fmt.Errorf("scan account row: %w", err)
		}
		out[name] = id
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate accounts: %w", err)
	}
	return out, nil
}
