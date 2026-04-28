package dbengine

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrInsufficientBalance is returned when an organization doesn't have enough balance for a withdrawal.
var ErrInsufficientBalance = errors.New("insufficient balance")

// ErrInvalidWithdrawalStatus is returned when a caller passes a status value
// outside the allowed enum. Callers should map this to HTTP 400.
var ErrInvalidWithdrawalStatus = errors.New("invalid withdrawal status")

// ErrWithdrawalNotFound is returned when a withdrawal does not exist or is not in the expected state.
var ErrWithdrawalNotFound = errors.New("withdrawal not found or not in expected state")

// withdrawalColumns is the shared SELECT column list for scanning into a Withdrawal.
const withdrawalColumns = `id, organization_id, amount, fee, net_amount, status,
	debit_transaction_id, completion_transaction_id, reversal_transaction_id,
	failure_code, failure_message,
	reviewed_by, reviewed_at, review_note,
	completed_by, failed_by,
	idempotency_key,
	created_at, approved_at, processed_at, completed_at, failed_at, reversed_at, canceled_at`

// scanWithdrawal scans a row into a Withdrawal struct. The column order must match withdrawalColumns.
func scanWithdrawal(row interface{ Scan(dest ...any) error }) (Withdrawal, error) {
	var w Withdrawal
	err := row.Scan(
		&w.ID, &w.OrganizationID, &w.Amount, &w.Fee, &w.NetAmount, &w.Status,
		&w.DebitTransactionID, &w.CompletionTransactionID, &w.ReversalTransactionID,
		&w.FailureCode, &w.FailureMessage,
		&w.ReviewedBy, &w.ReviewedAt, &w.ReviewNote,
		&w.CompletedBy, &w.FailedBy,
		&w.IdempotencyKey,
		&w.CreatedAt, &w.ApprovedAt, &w.ProcessedAt, &w.CompletedAt, &w.FailedAt, &w.ReversedAt, &w.CanceledAt,
	)
	return w, err
}

// getWithdrawalByIdempotencyKey returns an existing withdrawal matching the
// given idempotency key and organization. Used for idempotent replay.
func getWithdrawalByIdempotencyKey(ctx context.Context, pool *pgxpool.Pool, idempotencyKey, organizationID string) (Withdrawal, error) {
	w, err := scanWithdrawal(pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT %s FROM withdrawals WHERE idempotency_key = $1 AND organization_id = $2`, withdrawalColumns),
		idempotencyKey, organizationID,
	))
	if err != nil {
		return Withdrawal{}, fmt.Errorf("fetch existing withdrawal for idempotency replay: %w", err)
	}
	return w, nil
}

// CreateWithdrawal atomically checks the organization's balance, debits it,
// and creates a withdrawal record. Auto-approves if the amount is within the
// threshold. The entire operation runs in a single transaction with a row lock
// on the organization's account to prevent overdraw from concurrent requests.
//
// Authorization: the caller must be an admin of the organization. This is
// enforced atomically inside the account lock query via a JOIN on
// organization_members. If the caller is not an admin (or the organization
// doesn't exist) the function returns ErrWithdrawalNotFound. The ambiguity is
// intentional — don't disclose authorization state separately from existence.
func CreateWithdrawal(
	ctx context.Context, pool *pgxpool.Pool,
	organizationID string, amount int64, fee int64, idempotencyKey string,
	autoApprove bool, userID string,
) (Withdrawal, error) {
	if err := ValidateAmountAndFee(amount, fee); err != nil {
		return Withdrawal{}, err
	}

	netAmount := amount - fee

	tx, err := pool.Begin(ctx)
	if err != nil {
		return Withdrawal{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Idempotency: if a withdrawal with this key already exists for this
	// organization, return it immediately without doing any ledger work.
	existing, idempErr := scanWithdrawal(tx.QueryRow(ctx,
		fmt.Sprintf(`SELECT %s FROM withdrawals WHERE idempotency_key = $1 AND organization_id = $2`, withdrawalColumns),
		idempotencyKey, organizationID,
	))
	if idempErr == nil {
		tx.Rollback(ctx)
		return existing, nil
	}
	if !errors.Is(idempErr, pgx.ErrNoRows) {
		return Withdrawal{}, fmt.Errorf("check idempotency: %w", idempErr)
	}

	// Look up organization's USD LIABILITY account and lock it. The JOIN on
	// organization_members doubles as the authorization check — if the caller
	// is not an admin, zero rows are returned and we surface
	// ErrWithdrawalNotFound (see function-level comment on the ambiguity).
	var orgAcctID string
	err = tx.QueryRow(ctx,
		`SELECT a.id FROM accounts a
		 JOIN organization_members om ON om.organization_id = a.organization_id
		 WHERE a.organization_id = $1 AND om.user_id = $2 AND om.is_admin = true
		   AND a.type = 'LIABILITY' AND a.currency = 'USD'
		 FOR UPDATE OF a`,
		organizationID, userID,
	).Scan(&orgAcctID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Withdrawal{}, ErrWithdrawalNotFound
		}
		return Withdrawal{}, fmt.Errorf("lock organization account: %w", err)
	}

	// Compute balance under the lock. Only count confirmed transactions
	// so that pending (unsettled) payment credits cannot be withdrawn.
	var balance int64
	err = tx.QueryRow(ctx,
		`SELECT COALESCE(SUM(
			CASE le.direction
				WHEN 'CREDIT' THEN le.amount
				WHEN 'DEBIT'  THEN -le.amount
			END
		), 0)
		FROM ledger_entries le
		JOIN transactions t ON t.id = le.transaction_id
		WHERE le.account_id = $1 AND le.currency = 'USD'
		  AND t.status = 'confirmed'`,
		orgAcctID,
	).Scan(&balance)
	if err != nil {
		return Withdrawal{}, fmt.Errorf("compute balance: %w", err)
	}

	if balance < amount {
		return Withdrawal{}, fmt.Errorf("%w: have %d, need %d", ErrInsufficientBalance, balance, amount)
	}

	// Look up the withdrawal clearing system account.
	clearingAcctID, err := getSystemAccountIDTx(ctx, tx, SystemAccountWithdrawalClearing)
	if err != nil {
		return Withdrawal{}, err
	}

	// Generate withdrawal ID upfront so we can use it in the idempotency key.
	withdrawalID := uuid.New().String()
	ledgerIdempotencyKey := fmt.Sprintf("withdrawal-debit-%s", withdrawalID)

	// Determine initial status.
	status := WithdrawalStatusPendingApproval
	if autoApprove {
		status = WithdrawalStatusApproved
	}

	// Insert the ledger transaction: debit organization, credit clearing.
	var txnID string
	err = tx.QueryRow(ctx,
		`INSERT INTO transactions (idempotency_key)
		 VALUES ($1)
		 RETURNING id`,
		ledgerIdempotencyKey,
	).Scan(&txnID)
	if err != nil {
		return Withdrawal{}, fmt.Errorf("insert transaction: %w", err)
	}

	// DEBIT organization USD LIABILITY (balance goes down).
	_, err = tx.Exec(ctx,
		`INSERT INTO ledger_entries (transaction_id, currency, amount, direction, account_id)
		 VALUES ($1, 'USD', $2, 'DEBIT', $3)`,
		txnID, amount, orgAcctID,
	)
	if err != nil {
		return Withdrawal{}, fmt.Errorf("insert debit entry: %w", err)
	}

	// CREDIT withdrawal clearing (funds in transit).
	_, err = tx.Exec(ctx,
		`INSERT INTO ledger_entries (transaction_id, currency, amount, direction, account_id)
		 VALUES ($1, 'USD', $2, 'CREDIT', $3)`,
		txnID, amount, clearingAcctID,
	)
	if err != nil {
		return Withdrawal{}, fmt.Errorf("insert credit entry: %w", err)
	}

	// Insert withdrawal record.
	var w Withdrawal
	approvedAt := "NULL"
	if autoApprove {
		approvedAt = "NOW()"
	}

	query := fmt.Sprintf(
		`INSERT INTO withdrawals (id, organization_id, amount, fee, net_amount, status, debit_transaction_id, idempotency_key, approved_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, %s)
		 RETURNING %s`, approvedAt, withdrawalColumns)

	w, err = scanWithdrawal(tx.QueryRow(ctx, query,
		withdrawalID, organizationID, amount, fee, netAmount, status, txnID, idempotencyKey,
	))
	if err != nil {
		// Unique constraint on idempotency_key — concurrent retry slipped past
		// the early check. Rollback and return the existing row.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			tx.Rollback(ctx)
			return getWithdrawalByIdempotencyKey(ctx, pool, idempotencyKey, organizationID)
		}
		return Withdrawal{}, fmt.Errorf("insert withdrawal: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Withdrawal{}, fmt.Errorf("commit: %w", err)
	}

	return w, nil
}

// GetWithdrawalByID returns a withdrawal by its UUID.
func GetWithdrawalByID(ctx context.Context, pool *pgxpool.Pool, id string) (Withdrawal, error) {
	w, err := scanWithdrawal(pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT %s FROM withdrawals WHERE id = $1`, withdrawalColumns), id,
	))
	return w, err
}

// GetWithdrawalsByOrganizationPaginated returns paginated withdrawals for an
// organization with total count. Uses created_at as the cursor for stable,
// performant pagination.
func GetWithdrawalsByOrganizationPaginated(
	ctx context.Context,
	pool *pgxpool.Pool,
	organizationID string,
	limit int,
	cursor *time.Time,
) ([]Withdrawal, *time.Time, int, error) {
	args := []interface{}{organizationID}

	cursorWhere := ""
	if cursor != nil {
		cursorWhere = ` AND created_at < $2`
		args = append(args, *cursor)
	}

	// Fetch limit+1 to determine if more results exist.
	limitParam := len(args) + 1
	dataQuery := fmt.Sprintf(`
		SELECT %s
		FROM withdrawals
		WHERE organization_id = $1%s
		ORDER BY created_at DESC
		LIMIT $%d
	`, withdrawalColumns, cursorWhere, limitParam)

	// Get total count (separate query, no cursor condition).
	countQuery := `SELECT COUNT(*) FROM withdrawals WHERE organization_id = $1`

	var total int
	err := pool.QueryRow(ctx, countQuery, organizationID).Scan(&total)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("count query failed: %w", err)
	}

	// Fetch data with limit+1.
	dataArgs := append(args, limit+1)
	rows, err := pool.Query(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("query withdrawals: %w", err)
	}
	defer rows.Close()

	var withdrawals []Withdrawal
	for rows.Next() {
		w, err := scanWithdrawal(rows)
		if err != nil {
			return nil, nil, 0, fmt.Errorf("scan withdrawal: %w", err)
		}
		withdrawals = append(withdrawals, w)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, 0, err
	}

	// Handle empty results.
	if len(withdrawals) == 0 {
		return []Withdrawal{}, nil, total, nil
	}

	// Determine next cursor.
	var nextCursor *time.Time
	if len(withdrawals) > limit {
		withdrawals = withdrawals[:limit]
		lastTimestamp := withdrawals[len(withdrawals)-1].CreatedAt
		nextCursor = &lastTimestamp
	}

	return withdrawals, nextCursor, total, nil
}

// GetAllWithdrawalsPaginated returns paginated withdrawals across all merchants
// with an optional status filter. Used by admin endpoints.
func GetAllWithdrawalsPaginated(
	ctx context.Context,
	pool *pgxpool.Pool,
	status string,
	limit int,
	cursor *time.Time,
) ([]Withdrawal, *time.Time, int, error) {
	// Validate status if provided.
	validStatuses := map[string]bool{
		string(WithdrawalStatusPendingApproval): true,
		string(WithdrawalStatusApproved):        true,
		string(WithdrawalStatusProcessing):      true,
		string(WithdrawalStatusCompleted):       true,
		string(WithdrawalStatusFailed):          true,
		string(WithdrawalStatusReversed):        true,
		string(WithdrawalStatusCanceled):        true,
	}
	if status != "" && !validStatuses[status] {
		return nil, nil, 0, fmt.Errorf("%w: %s", ErrInvalidWithdrawalStatus, status)
	}

	// Build WHERE clauses dynamically based on optional filters.
	var whereClauses []string
	var args []interface{}
	paramIdx := 1

	if status != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("status = $%d", paramIdx))
		args = append(args, status)
		paramIdx++
	}

	if cursor != nil {
		whereClauses = append(whereClauses, fmt.Sprintf("created_at < $%d", paramIdx))
		args = append(args, *cursor)
		paramIdx++
	}

	whereSQL := ""
	if len(whereClauses) > 0 {
		whereSQL = "WHERE " + whereClauses[0]
		for _, clause := range whereClauses[1:] {
			whereSQL += " AND " + clause
		}
	}

	// Count query uses the same WHERE but without cursor condition.
	var countWhere string
	if status != "" {
		countWhere = "WHERE status = $1"
	}

	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM withdrawals %s`, countWhere)

	var total int
	if status != "" {
		err := pool.QueryRow(ctx, countQuery, status).Scan(&total)
		if err != nil {
			return nil, nil, 0, fmt.Errorf("count query failed: %w", err)
		}
	} else {
		err := pool.QueryRow(ctx, countQuery).Scan(&total)
		if err != nil {
			return nil, nil, 0, fmt.Errorf("count query failed: %w", err)
		}
	}

	// Fetch limit+1 to determine if more results exist.
	dataQuery := fmt.Sprintf(`
		SELECT %s FROM withdrawals %s
		ORDER BY created_at DESC
		LIMIT $%d
	`, withdrawalColumns, whereSQL, paramIdx)

	dataArgs := append(args, limit+1)
	rows, err := pool.Query(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("query withdrawals: %w", err)
	}
	defer rows.Close()

	var withdrawals []Withdrawal
	for rows.Next() {
		w, err := scanWithdrawal(rows)
		if err != nil {
			return nil, nil, 0, fmt.Errorf("scan withdrawal: %w", err)
		}
		withdrawals = append(withdrawals, w)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, 0, err
	}

	// Handle empty results.
	if len(withdrawals) == 0 {
		return []Withdrawal{}, nil, total, nil
	}

	// Determine next cursor.
	var nextCursor *time.Time
	if len(withdrawals) > limit {
		withdrawals = withdrawals[:limit]
		lastTimestamp := withdrawals[len(withdrawals)-1].CreatedAt
		nextCursor = &lastTimestamp
	}

	return withdrawals, nextCursor, total, nil
}

// ApproveWithdrawal transitions a withdrawal from pending_approval to approved.
func ApproveWithdrawal(ctx context.Context, pool *pgxpool.Pool, withdrawalID, adminUserID, note string) error {
	result, err := pool.Exec(ctx,
		`UPDATE withdrawals
		 SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_note = $3, approved_at = NOW()
		 WHERE id = $4 AND status = 'pending_approval'`,
		WithdrawalStatusApproved, adminUserID, note, withdrawalID,
	)
	if err != nil {
		return fmt.Errorf("approve withdrawal: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrWithdrawalNotFound
	}
	return nil
}

// getSystemAccountIDTx looks up a system account's ID within an existing transaction.
func getSystemAccountIDTx(ctx context.Context, tx pgx.Tx, name string) (string, error) {
	var id string
	err := tx.QueryRow(ctx,
		`SELECT id FROM accounts WHERE name = $1 AND currency = 'USD' AND organization_id IS NULL`,
		name,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("get system account %q: %w", name, err)
	}
	return id, nil
}

// getOrgLiabilityAccountIDTx looks up an organization's USD LIABILITY account ID within an existing transaction.
func getOrgLiabilityAccountIDTx(ctx context.Context, tx pgx.Tx, organizationID string) (string, error) {
	var id string
	err := tx.QueryRow(ctx,
		`SELECT id FROM accounts
		 WHERE organization_id = $1 AND type = 'LIABILITY' AND currency = 'USD'`,
		organizationID,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("get organization liability account: %w", err)
	}
	return id, nil
}

// writeReversalLedgerEntries is the shared reversal logic used by reject, cancel,
// and fail. Looks up the organization and clearing accounts, then writes the
// reversal ledger entries (debit clearing, credit organization). Returns the
// reversal transaction ID. Must be called within an existing DB transaction.
func writeReversalLedgerEntries(ctx context.Context, tx pgx.Tx, w Withdrawal, idempotencyKey string) (string, error) {
	orgAcctID, err := getOrgLiabilityAccountIDTx(ctx, tx, w.OrganizationID)
	if err != nil {
		return "", err
	}

	clearingAcctID, err := getSystemAccountIDTx(ctx, tx, SystemAccountWithdrawalClearing)
	if err != nil {
		return "", err
	}

	var txnID string
	err = tx.QueryRow(ctx,
		`INSERT INTO transactions (idempotency_key) VALUES ($1) RETURNING id`,
		idempotencyKey,
	).Scan(&txnID)
	if err != nil {
		return "", fmt.Errorf("insert reversal transaction: %w", err)
	}

	// DEBIT clearing (unwind the hold).
	_, err = tx.Exec(ctx,
		`INSERT INTO ledger_entries (transaction_id, currency, amount, direction, account_id)
		 VALUES ($1, 'USD', $2, 'DEBIT', $3)`,
		txnID, w.Amount, clearingAcctID,
	)
	if err != nil {
		return "", fmt.Errorf("insert reversal debit: %w", err)
	}

	// CREDIT organization (restore balance).
	_, err = tx.Exec(ctx,
		`INSERT INTO ledger_entries (transaction_id, currency, amount, direction, account_id)
		 VALUES ($1, 'USD', $2, 'CREDIT', $3)`,
		txnID, w.Amount, orgAcctID,
	)
	if err != nil {
		return "", fmt.Errorf("insert reversal credit: %w", err)
	}

	return txnID, nil
}

// RejectWithdrawal transitions a withdrawal from pending_approval to canceled
// and reverses the balance debit.
func RejectWithdrawal(ctx context.Context, pool *pgxpool.Pool, withdrawalID, adminUserID, note string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var w Withdrawal
	w, err = scanWithdrawal(tx.QueryRow(ctx,
		fmt.Sprintf(`SELECT %s FROM withdrawals WHERE id = $1 AND status = 'pending_approval' FOR UPDATE`, withdrawalColumns),
		withdrawalID,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrWithdrawalNotFound
		}
		return fmt.Errorf("load withdrawal for rejection: %w", err)
	}

	txnID, err := writeReversalLedgerEntries(ctx, tx, w, fmt.Sprintf("withdrawal-reversal-%s", withdrawalID))
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx,
		`UPDATE withdrawals
		 SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_note = $3,
		     canceled_at = NOW(), reversal_transaction_id = $4
		 WHERE id = $5`,
		WithdrawalStatusCanceled, adminUserID, note, txnID, withdrawalID,
	)
	if err != nil {
		return fmt.Errorf("update withdrawal: %w", err)
	}

	return tx.Commit(ctx)
}

// CancelWithdrawal atomically cancels a pending withdrawal if the caller is an
// admin of the organization that owns it.
//
// Returns ErrWithdrawalNotFound if: the withdrawal doesn't exist, it's not in
// pending_approval status, OR the caller is not an org admin. The ambiguity is
// intentional — don't disclose authorization state separately from existence.
func CancelWithdrawal(ctx context.Context, pool *pgxpool.Pool, withdrawalID, organizationID, userID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var w Withdrawal
	w, err = scanWithdrawal(tx.QueryRow(ctx,
		fmt.Sprintf(`
			SELECT %s FROM withdrawals
			WHERE id = $1 AND organization_id = $2 AND status = 'pending_approval'
			  AND EXISTS (
			    SELECT 1 FROM organization_members om
			    WHERE om.organization_id = $2 AND om.user_id = $3 AND om.is_admin = true
			  )
			FOR UPDATE`, withdrawalColumns),
		withdrawalID, organizationID, userID,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrWithdrawalNotFound
		}
		return fmt.Errorf("load withdrawal for cancellation: %w", err)
	}

	txnID, err := writeReversalLedgerEntries(ctx, tx, w, fmt.Sprintf("withdrawal-cancel-%s", withdrawalID))
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx,
		`UPDATE withdrawals
		 SET status = $1, canceled_at = NOW(), reversal_transaction_id = $2
		 WHERE id = $3`,
		WithdrawalStatusCanceled, txnID, withdrawalID,
	)
	if err != nil {
		return fmt.Errorf("update withdrawal: %w", err)
	}

	return tx.Commit(ctx)
}

// CompleteWithdrawal transitions a withdrawal to completed after the admin
// has manually sent the bank transfer. Writes a completion ledger entry
// moving funds from Withdrawal Clearing to USD Merchant Pool.
func CompleteWithdrawal(ctx context.Context, pool *pgxpool.Pool, withdrawalID, adminUserID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Load and lock the withdrawal.
	var w Withdrawal
	w, err = scanWithdrawal(tx.QueryRow(ctx,
		fmt.Sprintf(`SELECT %s FROM withdrawals WHERE id = $1 AND status IN ('approved', 'processing') FOR UPDATE`, withdrawalColumns),
		withdrawalID,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrWithdrawalNotFound
		}
		return fmt.Errorf("load withdrawal for completion: %w", err)
	}

	// Look up system accounts.
	clearingAcctID, err := getSystemAccountIDTx(ctx, tx, SystemAccountWithdrawalClearing)
	if err != nil {
		return err
	}

	poolAcctID, err := getSystemAccountIDTx(ctx, tx, SystemAccountUSDMerchantPool)
	if err != nil {
		return err
	}

	var feeRevenueAcctID string
	if w.Fee > 0 {
		feeRevenueAcctID, err = getSystemAccountIDTx(ctx, tx, SystemAccountPlatformFeeRevenue)
		if err != nil {
			return err
		}
	}

	// Write completion ledger entry.
	completionKey := fmt.Sprintf("withdrawal-complete-%s", withdrawalID)
	var txnID string
	err = tx.QueryRow(ctx,
		`INSERT INTO transactions (idempotency_key) VALUES ($1) RETURNING id`,
		completionKey,
	).Scan(&txnID)
	if err != nil {
		return fmt.Errorf("insert completion transaction: %w", err)
	}

	// DEBIT clearing (full gross amount leaves transit).
	_, err = tx.Exec(ctx,
		`INSERT INTO ledger_entries (transaction_id, currency, amount, direction, account_id)
		 VALUES ($1, 'USD', $2, 'DEBIT', $3)`,
		txnID, w.Amount, clearingAcctID,
	)
	if err != nil {
		return fmt.Errorf("insert completion debit: %w", err)
	}

	// CREDIT merchant pool (net amount leaves Sangria's pool to the merchant's bank).
	_, err = tx.Exec(ctx,
		`INSERT INTO ledger_entries (transaction_id, currency, amount, direction, account_id)
		 VALUES ($1, 'USD', $2, 'CREDIT', $3)`,
		txnID, w.NetAmount, poolAcctID,
	)
	if err != nil {
		return fmt.Errorf("insert completion credit: %w", err)
	}

	// CREDIT fee revenue (Sangria keeps the withdrawal fee).
	if w.Fee > 0 {
		_, err = tx.Exec(ctx,
			`INSERT INTO ledger_entries (transaction_id, currency, amount, direction, account_id)
			 VALUES ($1, 'USD', $2, 'CREDIT', $3)`,
			txnID, w.Fee, feeRevenueAcctID,
		)
		if err != nil {
			return fmt.Errorf("insert fee revenue credit: %w", err)
		}
	}

	// Update withdrawal status.
	_, err = tx.Exec(ctx,
		`UPDATE withdrawals
		 SET status = $1, completed_at = NOW(), completion_transaction_id = $2,
		     completed_by = $3
		 WHERE id = $4`,
		WithdrawalStatusCompleted, txnID, adminUserID, withdrawalID,
	)
	if err != nil {
		return fmt.Errorf("update withdrawal: %w", err)
	}

	return tx.Commit(ctx)
}

// FailWithdrawal transitions a withdrawal to failed and reverses the balance debit.
func FailWithdrawal(ctx context.Context, pool *pgxpool.Pool, withdrawalID, adminUserID, failureCode, failureMessage string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var w Withdrawal
	w, err = scanWithdrawal(tx.QueryRow(ctx,
		fmt.Sprintf(`SELECT %s FROM withdrawals WHERE id = $1 AND status IN ('approved', 'processing') FOR UPDATE`, withdrawalColumns),
		withdrawalID,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrWithdrawalNotFound
		}
		return fmt.Errorf("load withdrawal for failure: %w", err)
	}

	txnID, err := writeReversalLedgerEntries(ctx, tx, w, fmt.Sprintf("withdrawal-failure-%s", withdrawalID))
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx,
		`UPDATE withdrawals
		 SET status = $1, failed_at = NOW(), failure_code = $2, failure_message = $3,
		     reversal_transaction_id = $4, failed_by = $5
		 WHERE id = $6`,
		WithdrawalStatusFailed, failureCode, failureMessage, txnID, adminUserID, withdrawalID,
	)
	if err != nil {
		return fmt.Errorf("update withdrawal: %w", err)
	}

	return tx.Commit(ctx)
}
