package dbengine

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// GetAllTransactions returns all transactions.
func GetAllTransactions(ctx context.Context, pool *pgxpool.Pool) ([]Transaction, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, idempotency_key, created_at FROM transactions ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txns []Transaction
	for rows.Next() {
		var t Transaction
		if err := rows.Scan(&t.ID, &t.IdempotencyKey, &t.CreatedAt); err != nil {
			return nil, err
		}
		txns = append(txns, t)
	}
	return txns, rows.Err()
}

// GetAllLedgerEntries returns all ledger entries ordered by transaction.
func GetAllLedgerEntries(ctx context.Context, pool *pgxpool.Pool) ([]LedgerEntry, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, transaction_id, currency, amount, direction, account_id
		 FROM ledger_entries ORDER BY transaction_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []LedgerEntry
	for rows.Next() {
		var e LedgerEntry
		if err := rows.Scan(&e.ID, &e.TransactionID, &e.Currency, &e.Amount, &e.Direction,
			&e.AccountID); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// GetLedgerEntriesByTransaction returns ledger entries for a specific transaction.
func GetLedgerEntriesByTransaction(ctx context.Context, pool *pgxpool.Pool, txID string) ([]LedgerEntry, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, transaction_id, currency, amount, direction, account_id
		 FROM ledger_entries WHERE transaction_id = $1 ORDER BY id`, txID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []LedgerEntry
	for rows.Next() {
		var e LedgerEntry
		if err := rows.Scan(&e.ID, &e.TransactionID, &e.Currency, &e.Amount, &e.Direction,
			&e.AccountID); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// GetUserTransactions returns all transactions for a specific user.
// Only returns transactions where the user received payment (CREDIT to LIABILITY account).
func GetUserTransactions(ctx context.Context, pool *pgxpool.Pool, userID string) ([]UserTransaction, error) {
	query := `
		SELECT
			t.id,
			t.idempotency_key,
			t.created_at,
			le.amount,
			le.currency,
			COALESCE(cw.network::text, '') as network
		FROM transactions t
		JOIN ledger_entries le ON le.transaction_id = t.id
		JOIN accounts a ON a.id = le.account_id
		LEFT JOIN crypto_wallets cw ON cw.account_id = a.id
		WHERE a.user_id = $1
		  AND a.type = 'LIABILITY'
		  AND le.direction = 'CREDIT'
		ORDER BY t.created_at DESC
		LIMIT 1000
	`

	rows, err := pool.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transactions []UserTransaction
	for rows.Next() {
		var tx UserTransaction
		err := rows.Scan(
			&tx.ID,
			&tx.IdempotencyKey,
			&tx.CreatedAt,
			&tx.Amount,
			&tx.Currency,
			&tx.Network,
		)
		if err != nil {
			return nil, err
		}

		tx.Type = "payment_received"
		transactions = append(transactions, tx)
	}

	if transactions == nil {
		transactions = []UserTransaction{}
	}

	return transactions, rows.Err()
}

// GetUserTransactionsPaginated returns paginated transactions for a user with total count.
// Uses created_at as cursor for stable, performant pagination.
// Also returns total count of all transactions (requires additional COUNT query).
func GetUserTransactionsPaginated(
	ctx context.Context,
	pool *pgxpool.Pool,
	userID string,
	limit int,
	cursor *time.Time,
) ([]UserTransaction, *time.Time, int, error) {
	// Build WHERE clause with cursor condition
	baseWhere := `
		WHERE a.user_id = $1
		  AND a.type = 'LIABILITY'
		  AND le.direction = 'CREDIT'
	`
	args := []interface{}{userID}

	cursorWhere := ""
	if cursor != nil {
		cursorWhere = ` AND t.created_at < $2`
		args = append(args, *cursor)
	}

	// Fetch limit+1 to determine if more results exist
	limitParam := len(args) + 1
	dataQuery := fmt.Sprintf(`
		SELECT
			t.id,
			t.idempotency_key,
			t.created_at,
			le.amount,
			le.currency,
			COALESCE(cw.network::text, '') as network
		FROM transactions t
		JOIN ledger_entries le ON le.transaction_id = t.id
		JOIN accounts a ON a.id = le.account_id
		LEFT JOIN crypto_wallets cw ON cw.account_id = a.id
		%s%s
		ORDER BY t.created_at DESC
		LIMIT $%d
	`, baseWhere, cursorWhere, limitParam)

	// Get total count (separate query)
	countQuery := fmt.Sprintf(`
		SELECT COUNT(DISTINCT t.id)
		FROM transactions t
		JOIN ledger_entries le ON le.transaction_id = t.id
		JOIN accounts a ON a.id = le.account_id
		%s
	`, baseWhere)

	var total int
	err := pool.QueryRow(ctx, countQuery, userID).Scan(&total)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("count query failed: %w", err)
	}

	// Fetch data with limit+1
	dataArgs := append(args, limit+1)
	rows, err := pool.Query(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, nil, 0, err
	}
	defer rows.Close()

	var transactions []UserTransaction
	for rows.Next() {
		var tx UserTransaction
		err := rows.Scan(
			&tx.ID,
			&tx.IdempotencyKey,
			&tx.CreatedAt,
			&tx.Amount,
			&tx.Currency,
			&tx.Network,
		)
		if err != nil {
			return nil, nil, 0, err
		}
		tx.Type = "payment_received"
		transactions = append(transactions, tx)
	}

	if err := rows.Err(); err != nil {
		return nil, nil, 0, err
	}

	// Handle empty results
	if len(transactions) == 0 {
		return []UserTransaction{}, nil, total, nil
	}

	// Determine next cursor
	var nextCursor *time.Time
	if len(transactions) > limit {
		// More results exist, trim to limit and set cursor
		transactions = transactions[:limit]
		lastTimestamp := transactions[len(transactions)-1].CreatedAt
		nextCursor = &lastTimestamp
	}

	return transactions, nextCursor, total, nil
}
