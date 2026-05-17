package dbengine

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultTrialCreditMicrounits is the trial credit (in microunits) auto-granted
// to a user's PERSONAL agent operator at signup. $1 USD == 1_000_000 microunits.
// Only personal orgs (is_personal=true) receive this — user-created additional
// orgs get an operator with $0 trial. Caps each WorkOS user to one trial
// regardless of how many orgs they create. Hardcoded for V0/V1; promote to
// env-var config when the agent platform has a real fee model and we want to
// tune the trial as a growth lever.
const DefaultTrialCreditMicrounits int64 = 1_000_000

// agentOperatorColumns is the canonical SELECT / RETURNING column list for
// agent_operators rows. Keeps the Scan() target order in sync everywhere.
const agentOperatorColumns = `id, organization_id, trial_credit_microunits, stripe_customer_id, kyc_status, address, created_at`

// scanAgentOperator scans a row produced by SELECT agentOperatorColumns into
// an AgentOperator struct.
func scanAgentOperator(row pgx.Row) (AgentOperator, error) {
	var o AgentOperator
	err := row.Scan(
		&o.ID, &o.OrganizationID, &o.TrialCreditMicrounits,
		&o.StripeCustomerID, &o.KYCStatus, &o.Address, &o.CreatedAt,
	)
	return o, err
}

// GetAgentOperatorByID returns the agent_operators row with the given ID.
// Returns ErrAgentOperatorNotFound if no row matches.
func GetAgentOperatorByID(ctx context.Context, pool *pgxpool.Pool, operatorID string) (AgentOperator, error) {
	if strings.TrimSpace(operatorID) == "" {
		return AgentOperator{}, fmt.Errorf("operator ID must not be empty")
	}
	row := pool.QueryRow(ctx,
		`SELECT `+agentOperatorColumns+` FROM agent_operators WHERE id = $1`,
		operatorID,
	)
	op, err := scanAgentOperator(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return AgentOperator{}, ErrAgentOperatorNotFound
	}
	if err != nil {
		return AgentOperator{}, fmt.Errorf("get agent operator by ID: %w", err)
	}
	return op, nil
}

// CreateAgentOperator atomically creates an operator row, its two LIABILITY/USD
// credit accounts (Trial + Paid), and — if trialAmount > 0 — the trial-grant
// topup row plus the matching ledger transaction. All steps commit together or
// not at all. Idempotent on organization_id: a retry against an org that
// already has an operator returns the existing row unchanged.
//
// Pool-owning entry point. Callers that need to compose operator creation
// with other inserts inside an outer atomic envelope should call
// CreateAgentOperatorTx directly with their existing tx.
func CreateAgentOperator(ctx context.Context, pool *pgxpool.Pool, orgID string, trialAmount int64) (AgentOperator, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return AgentOperator{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) // safe no-op once Commit fires

	op, err := CreateAgentOperatorTx(ctx, tx, orgID, trialAmount)
	if err != nil {
		return AgentOperator{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return AgentOperator{}, fmt.Errorf("commit: %w", err)
	}
	return op, nil
}

// CreateAgentOperatorTx is the in-tx core of CreateAgentOperator. Caller owns
// the tx (begin/commit/rollback). Same idempotency guarantees: if an operator
// already exists for the given orgID, returns the existing row without
// re-creating accounts or re-granting trial credit. Used by signup flows
// (EnsurePersonalOrganizationTx, dbengine.CreateOrganization) that need
// operator creation to commit atomically with the surrounding org + member
// inserts.
func CreateAgentOperatorTx(ctx context.Context, tx pgx.Tx, orgID string, trialAmount int64) (AgentOperator, error) {
	if strings.TrimSpace(orgID) == "" {
		return AgentOperator{}, fmt.Errorf("organization ID must not be empty")
	}
	if trialAmount < 0 {
		return AgentOperator{}, fmt.Errorf("trial amount must be non-negative, got %d", trialAmount)
	}

	// 1. Insert the operator row. The UNIQUE on organization_id serializes
	//    concurrent creates; on conflict we return the existing row.
	row := tx.QueryRow(ctx,
		`INSERT INTO agent_operators (organization_id, trial_credit_microunits, kyc_status)
		 VALUES ($1, $2, 'unverified')
		 ON CONFLICT (organization_id) DO NOTHING
		 RETURNING `+agentOperatorColumns,
		orgID, trialAmount,
	)
	op, err := scanAgentOperator(row)
	if errors.Is(err, pgx.ErrNoRows) {
		// Operator already exists — return it; do NOT re-grant trial.
		existing, getErr := getAgentOperatorByOrgIDInTx(ctx, tx, orgID)
		if getErr != nil {
			return AgentOperator{}, fmt.Errorf("read existing operator after conflict: %w", getErr)
		}
		return existing, nil
	}
	if err != nil {
		return AgentOperator{}, fmt.Errorf("insert agent operator: %w", err)
	}

	// 2. Ensure the operator's per-org credit accounts exist.
	trialAcct, _, err := getOrCreateAgentCreditsAccountsInTx(ctx, tx, orgID)
	if err != nil {
		return AgentOperator{}, fmt.Errorf("ensure credit accounts: %w", err)
	}

	// 3. If a trial was granted, record the topup + matching ledger entry.
	if trialAmount > 0 {
		if err := grantTrialCreditInTx(ctx, tx, op.ID, trialAcct.ID, trialAmount); err != nil {
			return AgentOperator{}, err
		}
	}

	return op, nil
}

// GetAgentCreditsBalances returns the operator's Trial and Paid credit balances
// in microunits. Sums confirmed ledger entries against the two per-org
// LIABILITY/USD accounts; a CREDIT raises the balance (we owe more), a DEBIT
// lowers it. Returns (0, 0, nil) for an org with no agent operator yet.
// Accepts a pool or pgx.Tx via the queryer interface so CreateAgentPayment can
// recompute the balance inside its FOR-UPDATE lock.
func GetAgentCreditsBalances(ctx context.Context, q queryer, orgID string) (trial, paid int64, err error) {
	if strings.TrimSpace(orgID) == "" {
		return 0, 0, fmt.Errorf("organization ID must not be empty")
	}

	trialName := AgentCreditsTrialAccountName(orgID)
	paidName := AgentCreditsPaidAccountName(orgID)

	err = q.QueryRow(ctx, `
		SELECT
		  COALESCE(SUM(CASE WHEN a.name = $1 AND le.direction = 'CREDIT' THEN le.amount
		                    WHEN a.name = $1 AND le.direction = 'DEBIT'  THEN -le.amount
		                    ELSE 0 END), 0),
		  COALESCE(SUM(CASE WHEN a.name = $2 AND le.direction = 'CREDIT' THEN le.amount
		                    WHEN a.name = $2 AND le.direction = 'DEBIT'  THEN -le.amount
		                    ELSE 0 END), 0)
		FROM ledger_entries le
		JOIN accounts a     ON a.id = le.account_id
		JOIN transactions t ON t.id = le.transaction_id
		WHERE a.organization_id = $3
		  AND a.type = 'LIABILITY' AND a.currency = 'USD'
		  AND a.name IN ($1, $2)
		  AND t.status = 'confirmed'
	`, trialName, paidName, orgID).Scan(&trial, &paid)

	if err != nil {
		return 0, 0, fmt.Errorf("get agent credits balances: %w", err)
	}
	return trial, paid, nil
}

// getAgentOperatorByOrgIDInTx reads the operator row by organization_id inside
// an existing tx. Unexported because the orgID lookup is only needed during
// CreateAgentOperator's conflict-recovery path; external callers use
// GetAgentOperatorByID.
func getAgentOperatorByOrgIDInTx(ctx context.Context, tx pgx.Tx, orgID string) (AgentOperator, error) {
	row := tx.QueryRow(ctx,
		`SELECT `+agentOperatorColumns+` FROM agent_operators WHERE organization_id = $1`,
		orgID,
	)
	op, err := scanAgentOperator(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return AgentOperator{}, ErrAgentOperatorNotFound
	}
	if err != nil {
		return AgentOperator{}, fmt.Errorf("read operator by org ID: %w", err)
	}
	return op, nil
}

// getOrCreateAgentCreditsAccountsInTx ensures both per-operator credit accounts
// (Trial + Paid) exist for the given org and returns them. Called inside
// CreateAgentOperator's atomic tx; accounts created here commit with the
// operator row.
func getOrCreateAgentCreditsAccountsInTx(ctx context.Context, tx pgx.Tx, orgID string) (trialAcct, paidAcct Account, err error) {
	trialAcct, err = getOrCreateLiabilityAccountInTx(ctx, tx, orgID, AgentCreditsTrialAccountName(orgID))
	if err != nil {
		return Account{}, Account{}, fmt.Errorf("trial account: %w", err)
	}
	paidAcct, err = getOrCreateLiabilityAccountInTx(ctx, tx, orgID, AgentCreditsPaidAccountName(orgID))
	if err != nil {
		return Account{}, Account{}, fmt.Errorf("paid account: %w", err)
	}
	return trialAcct, paidAcct, nil
}

// getOrCreateLiabilityAccountInTx upserts a single LIABILITY/USD account for an
// org. Uses INSERT ... ON CONFLICT DO NOTHING RETURNING with a fallback SELECT
// — same pattern as InsertTransaction's idempotency-key handling, conflict-safe
// against the uq_accounts_org_name_liability_usd partial unique index. The
// ON CONFLICT clause uses column+predicate inference (not ON CONSTRAINT)
// because partial unique INDEXES aren't named constraints in Postgres's eyes;
// the WHERE clause must exactly match the partial-index predicate.
func getOrCreateLiabilityAccountInTx(ctx context.Context, tx pgx.Tx, orgID, name string) (Account, error) {
	var a Account
	err := tx.QueryRow(ctx,
		`INSERT INTO accounts (name, type, currency, organization_id)
		 VALUES ($1, 'LIABILITY', 'USD', $2)
		 ON CONFLICT (organization_id, name) WHERE type = 'LIABILITY' AND currency = 'USD' DO NOTHING
		 RETURNING id, name, type, currency, organization_id, created_at`,
		name, orgID,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.OrganizationID, &a.CreatedAt)
	if err == nil {
		return a, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Account{}, fmt.Errorf("insert account %q: %w", name, err)
	}

	err = tx.QueryRow(ctx,
		`SELECT id, name, type, currency, organization_id, created_at
		 FROM accounts
		 WHERE organization_id = $1 AND name = $2
		   AND type = 'LIABILITY' AND currency = 'USD'`,
		orgID, name,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.OrganizationID, &a.CreatedAt)
	if err != nil {
		return Account{}, fmt.Errorf("read existing account %q after conflict: %w", name, err)
	}
	return a, nil
}

// grantTrialCreditInTx records the SIGNUP-TIME trial credit: inserts an
// agent_topups row (source='trial', direction='CREDIT'), writes the matching
// double-entry ledger transaction via insertTransactionInTx (DEBIT the
// marketing expense account, CREDIT the operator's trial liability), then
// marks the topup completed with the ledger linkage. All inside the caller's
// tx so the trial grant commits atomically with the operator creation.
//
// This is the only path that uses the deterministic idempotency key
// "trial-grant-<operator_id>". That key is load-bearing for retry safety —
// it ensures a partial-failure retry of CreateAgentOperator returns the
// existing topup row rather than double-granting. As a side effect, this
// function can only be called ONCE per operator; the second call no-ops on
// the unique (agent_operator_id, idempotency_key) constraint.
//
// For any other credit grant — support comps, beta-promo bonuses, refund-
// then-regrant, etc. — call dbengine.CreateAgentTopup directly with a
// distinct caller-supplied idempotency key. Do NOT extend this function to
// take a sequence number; the at-signup grant is a separate concern from
// arbitrary post-signup grants and shouldn't be confused with them.
func grantTrialCreditInTx(ctx context.Context, tx pgx.Tx, operatorID, trialAcctID string, amount int64) error {
	trialGrantsAcct, err := GetSystemAccount(ctx, tx, SystemAccountTrialGrantsIssued, USD)
	if err != nil {
		return fmt.Errorf("lookup trial grants system account: %w", err)
	}

	idempotencyKey := "trial-grant-" + operatorID

	var topupID string
	err = tx.QueryRow(ctx,
		`INSERT INTO agent_topups
		    (agent_operator_id, direction, source, amount_credits_microunits,
		     idempotency_key, status)
		 VALUES ($1, 'CREDIT', 'trial', $2, $3, 'pending')
		 ON CONFLICT (agent_operator_id, idempotency_key) DO NOTHING
		 RETURNING id`,
		operatorID, amount, idempotencyKey,
	).Scan(&topupID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Topup row already exists (retry safety net) — nothing to do.
		return nil
	}
	if err != nil {
		return fmt.Errorf("insert trial topup row: %w", err)
	}

	entries, err := insertTransactionInTx(ctx, tx, idempotencyKey, []LedgerLine{
		{Currency: USD, Amount: amount, Direction: Debit, AccountID: trialGrantsAcct.ID},
		{Currency: USD, Amount: amount, Direction: Credit, AccountID: trialAcctID},
	})
	if err != nil {
		return fmt.Errorf("write trial grant ledger entries: %w", err)
	}
	if len(entries) == 0 {
		return fmt.Errorf("trial grant ledger write returned no entries")
	}

	_, err = tx.Exec(ctx,
		`UPDATE agent_topups
		 SET status = 'completed', completed_at = NOW(), ledger_transaction_id = $1
		 WHERE id = $2`,
		entries[0].TransactionID, topupID,
	)
	if err != nil {
		return fmt.Errorf("mark trial topup completed: %w", err)
	}

	return nil
}
