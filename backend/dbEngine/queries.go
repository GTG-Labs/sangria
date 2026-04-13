package dbengine

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// GetAccountBalance returns the net balance (in microunits) of an organization's USD
// LIABILITY account by summing all ledger entries: credits minus debits.
func GetAccountBalance(ctx context.Context, pool *pgxpool.Pool, organizationID string) (int64, error) {
	var balance int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(
			CASE WHEN le.direction = 'CREDIT' THEN le.amount
			     WHEN le.direction = 'DEBIT'  THEN -le.amount
			END
		), 0)
		FROM ledger_entries le
		JOIN accounts a ON a.id = le.account_id
		JOIN transactions t ON t.id = le.transaction_id
		WHERE a.organization_id = $1
		  AND a.type = 'LIABILITY'
		  AND a.currency = 'USD'
		  AND t.status = 'confirmed'
	`, organizationID).Scan(&balance)
	return balance, err
}

// GetMerchantTransactionsPaginated returns paginated transactions for a merchant with total count.
// Uses created_at as cursor for stable, performant pagination.
// Also returns total count of all transactions (requires additional COUNT query).
func GetMerchantTransactionsPaginated(
	ctx context.Context,
	pool *pgxpool.Pool,
	organizationID string,
	limit int,
	cursor *time.Time,
) ([]MerchantTransaction, *time.Time, int, error) {
	// Build WHERE clause with cursor condition
	baseWhere := `
		WHERE a.organization_id = $1
		  AND a.type = 'LIABILITY'
		  AND le.direction = 'CREDIT'
		  AND t.status = 'confirmed'
	`
	args := []interface{}{organizationID}

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
			le.currency
		FROM transactions t
		JOIN ledger_entries le ON le.transaction_id = t.id
		JOIN accounts a ON a.id = le.account_id
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
	err := pool.QueryRow(ctx, countQuery, organizationID).Scan(&total)
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

	var transactions []MerchantTransaction
	for rows.Next() {
		var tx MerchantTransaction
		err := rows.Scan(
			&tx.ID,
			&tx.IdempotencyKey,
			&tx.CreatedAt,
			&tx.Amount,
			&tx.Currency,
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
		return []MerchantTransaction{}, nil, total, nil
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
