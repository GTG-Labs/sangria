package dbengine

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrInsufficientBalance is returned when a merchant doesn't have enough balance for a withdrawal.
var ErrInsufficientBalance = errors.New("insufficient balance")

// ErrWithdrawalNotFound is returned when a withdrawal does not exist or is not in the expected state.
var ErrWithdrawalNotFound = errors.New("withdrawal not found or not in expected state")

// withdrawalColumns is the shared SELECT column list for scanning into a Withdrawal.
const withdrawalColumns = `id, merchant_id, amount, fee, net_amount, status,
	debit_transaction_id, completion_transaction_id, reversal_transaction_id,
	failure_code, failure_message,
	reviewed_by, reviewed_at, review_note,
	idempotency_key,
	created_at, approved_at, processed_at, completed_at, failed_at, reversed_at, canceled_at`

// scanWithdrawal scans a row into a Withdrawal struct. The column order must match withdrawalColumns.
func scanWithdrawal(row interface{ Scan(dest ...any) error }) (Withdrawal, error) {
	var w Withdrawal
	err := row.Scan(
		&w.ID, &w.MerchantID, &w.Amount, &w.Fee, &w.NetAmount, &w.Status,
		&w.DebitTransactionID, &w.CompletionTransactionID, &w.ReversalTransactionID,
		&w.FailureCode, &w.FailureMessage,
		&w.ReviewedBy, &w.ReviewedAt, &w.ReviewNote,
		&w.IdempotencyKey,
		&w.CreatedAt, &w.ApprovedAt, &w.ProcessedAt, &w.CompletedAt, &w.FailedAt, &w.ReversedAt, &w.CanceledAt,
	)
	return w, err
}

// getWithdrawalByIdempotencyKey returns an existing withdrawal matching the
// given idempotency key and merchant. Used for idempotent replay.
func getWithdrawalByIdempotencyKey(ctx context.Context, pool *pgxpool.Pool, idempotencyKey, merchantID string) (Withdrawal, error) {
	w, err := scanWithdrawal(pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT %s FROM withdrawals WHERE idempotency_key = $1 AND merchant_id = $2`, withdrawalColumns),
		idempotencyKey, merchantID,
	))
	if err != nil {
		return Withdrawal{}, fmt.Errorf("fetch existing withdrawal for idempotency replay: %w", err)
	}
	return w, nil
}

// CreateWithdrawal atomically checks the merchant's balance, debits it, and
// creates a withdrawal record. Auto-approves if the amount is within the
// threshold. The entire operation runs in a single transaction with a row lock
// on the merchant's account to prevent overdraw from concurrent requests.
func CreateWithdrawal(
	ctx context.Context, pool *pgxpool.Pool,
	merchantID string, amount int64, fee int64, idempotencyKey string,
	autoApprove bool,
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
	// merchant, return it immediately without doing any ledger work.
	existing, idempErr := scanWithdrawal(tx.QueryRow(ctx,
		fmt.Sprintf(`SELECT %s FROM withdrawals WHERE idempotency_key = $1 AND merchant_id = $2`, withdrawalColumns),
		idempotencyKey, merchantID,
	))
	if idempErr == nil {
		tx.Rollback(ctx)
		return existing, nil
	}
	if !errors.Is(idempErr, pgx.ErrNoRows) {
		return Withdrawal{}, fmt.Errorf("check idempotency: %w", idempErr)
	}

	// Look up merchant's USD LIABILITY account and lock it.
	var merchantAcctID string
	err = tx.QueryRow(ctx,
		`SELECT a.id FROM accounts a
		 JOIN merchants m ON m.user_id = a.user_id
		 WHERE m.id = $1 AND a.type = 'LIABILITY' AND a.currency = 'USD'
		 FOR UPDATE`,
		merchantID,
	).Scan(&merchantAcctID)
	if err != nil {
		return Withdrawal{}, fmt.Errorf("lock merchant account: %w", err)
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
		merchantAcctID,
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

	// Insert the ledger transaction: debit merchant, credit clearing.
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

	// DEBIT merchant USD LIABILITY (balance goes down).
	_, err = tx.Exec(ctx,
		`INSERT INTO ledger_entries (transaction_id, currency, amount, direction, account_id)
		 VALUES ($1, 'USD', $2, 'DEBIT', $3)`,
		txnID, amount, merchantAcctID,
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
		`INSERT INTO withdrawals (id, merchant_id, amount, fee, net_amount, status, debit_transaction_id, idempotency_key, approved_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, %s)
		 RETURNING %s`, approvedAt, withdrawalColumns)

	w, err = scanWithdrawal(tx.QueryRow(ctx, query,
		withdrawalID, merchantID, amount, fee, netAmount, status, txnID, idempotencyKey,
	))
	if err != nil {
		// Unique constraint on idempotency_key — concurrent retry slipped past
		// the early check. Rollback and return the existing row.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			tx.Rollback(ctx)
			return getWithdrawalByIdempotencyKey(ctx, pool, idempotencyKey, merchantID)
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

// ListWithdrawalsByMerchant returns all withdrawals for a merchant, ordered by created_at desc.
func ListWithdrawalsByMerchant(ctx context.Context, pool *pgxpool.Pool, merchantID string) ([]Withdrawal, error) {
	rows, err := pool.Query(ctx,
		fmt.Sprintf(`SELECT %s FROM withdrawals WHERE merchant_id = $1 ORDER BY created_at DESC`, withdrawalColumns),
		merchantID,
	)
	if err != nil {
		return nil, fmt.Errorf("query withdrawals: %w", err)
	}
	defer rows.Close()

	var withdrawals []Withdrawal
	for rows.Next() {
		w, err := scanWithdrawal(rows)
		if err != nil {
			return nil, fmt.Errorf("scan withdrawal: %w", err)
		}
		withdrawals = append(withdrawals, w)
	}
	return withdrawals, rows.Err()
}

// ListAllWithdrawals returns all withdrawals, ordered by created_at desc.
func ListAllWithdrawals(ctx context.Context, pool *pgxpool.Pool) ([]Withdrawal, error) {
	rows, err := pool.Query(ctx,
		fmt.Sprintf(`SELECT %s FROM withdrawals ORDER BY created_at DESC`, withdrawalColumns),
	)
	if err != nil {
		return nil, fmt.Errorf("query withdrawals: %w", err)
	}
	defer rows.Close()

	var withdrawals []Withdrawal
	for rows.Next() {
		w, err := scanWithdrawal(rows)
		if err != nil {
			return nil, fmt.Errorf("scan withdrawal: %w", err)
		}
		withdrawals = append(withdrawals, w)
	}
	return withdrawals, rows.Err()
}

// ListWithdrawalsByStatus returns all withdrawals with the given status, ordered by created_at asc.
func ListWithdrawalsByStatus(ctx context.Context, pool *pgxpool.Pool, status WithdrawalStatus) ([]Withdrawal, error) {
	rows, err := pool.Query(ctx,
		fmt.Sprintf(`SELECT %s FROM withdrawals WHERE status = $1 ORDER BY created_at ASC`, withdrawalColumns),
		status,
	)
	if err != nil {
		return nil, fmt.Errorf("query withdrawals: %w", err)
	}
	defer rows.Close()

	var withdrawals []Withdrawal
	for rows.Next() {
		w, err := scanWithdrawal(rows)
		if err != nil {
			return nil, fmt.Errorf("scan withdrawal: %w", err)
		}
		withdrawals = append(withdrawals, w)
	}
	return withdrawals, rows.Err()
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
		`SELECT id FROM accounts WHERE name = $1 AND currency = 'USD' AND user_id IS NULL`,
		name,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("get system account %q: %w", name, err)
	}
	return id, nil
}

// getMerchantLiabilityAccountIDTx looks up a merchant's USD LIABILITY account ID within an existing transaction.
func getMerchantLiabilityAccountIDTx(ctx context.Context, tx pgx.Tx, merchantID string) (string, error) {
	var id string
	err := tx.QueryRow(ctx,
		`SELECT a.id FROM accounts a
		 JOIN merchants m ON m.user_id = a.user_id
		 WHERE m.id = $1 AND a.type = 'LIABILITY' AND a.currency = 'USD'`,
		merchantID,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("get merchant liability account: %w", err)
	}
	return id, nil
}

// writeReversalLedgerEntries is the shared reversal logic used by reject, cancel,
// and fail. Looks up the merchant and clearing accounts, then writes the reversal
// ledger entries (debit clearing, credit merchant). Returns the reversal
// transaction ID. Must be called within an existing DB transaction.
func writeReversalLedgerEntries(ctx context.Context, tx pgx.Tx, w Withdrawal, idempotencyKey string) (string, error) {
	merchantAcctID, err := getMerchantLiabilityAccountIDTx(ctx, tx, w.MerchantID)
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

	// CREDIT merchant (restore balance).
	_, err = tx.Exec(ctx,
		`INSERT INTO ledger_entries (transaction_id, currency, amount, direction, account_id)
		 VALUES ($1, 'USD', $2, 'CREDIT', $3)`,
		txnID, w.Amount, merchantAcctID,
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

// CancelWithdrawal allows a merchant to cancel their own pending_approval withdrawal.
// Verifies the withdrawal belongs to the given merchant before reversing.
func CancelWithdrawal(ctx context.Context, pool *pgxpool.Pool, withdrawalID, merchantID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var w Withdrawal
	w, err = scanWithdrawal(tx.QueryRow(ctx,
		fmt.Sprintf(`SELECT %s FROM withdrawals WHERE id = $1 AND merchant_id = $2 AND status = 'pending_approval' FOR UPDATE`, withdrawalColumns),
		withdrawalID, merchantID,
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
func CompleteWithdrawal(ctx context.Context, pool *pgxpool.Pool, withdrawalID string) error {
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
		 SET status = $1, completed_at = NOW(), completion_transaction_id = $2
		 WHERE id = $3`,
		WithdrawalStatusCompleted, txnID, withdrawalID,
	)
	if err != nil {
		return fmt.Errorf("update withdrawal: %w", err)
	}

	return tx.Commit(ctx)
}

// FailWithdrawal transitions a withdrawal to failed and reverses the balance debit.
func FailWithdrawal(ctx context.Context, pool *pgxpool.Pool, withdrawalID, failureCode, failureMessage string) error {
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
		     reversal_transaction_id = $4
		 WHERE id = $5`,
		WithdrawalStatusFailed, failureCode, failureMessage, txnID, withdrawalID,
	)
	if err != nil {
		return fmt.Errorf("update withdrawal: %w", err)
	}

	return tx.Commit(ctx)
}
