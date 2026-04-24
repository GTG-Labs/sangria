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

// AdminTransactionFilters holds optional filters for the admin transactions query.
type AdminTransactionFilters struct {
	OrganizationID *string
	Search         *string    // matches against idempotency_key
	StartDate      *time.Time
	EndDate        *time.Time
}

// GetAdminTransactionsPaginated returns enriched, paginated transactions across all merchants.
// Includes merchant name, fee breakdown, and supports filtering.
func GetAdminTransactionsPaginated(
	ctx context.Context,
	pool *pgxpool.Pool,
	limit int,
	cursor *time.Time,
	filters AdminTransactionFilters,
) ([]AdminTransaction, *time.Time, int, error) {
	// Build dynamic WHERE clauses and args
	paramIdx := 1
	var conditions []string
	var args []interface{}

	if cursor != nil {
		conditions = append(conditions, fmt.Sprintf("t.created_at < $%d", paramIdx))
		args = append(args, *cursor)
		paramIdx++
	}
	if filters.OrganizationID != nil {
		conditions = append(conditions, fmt.Sprintf("o.id = $%d", paramIdx))
		args = append(args, *filters.OrganizationID)
		paramIdx++
	}
	if filters.Search != nil {
		conditions = append(conditions, fmt.Sprintf("t.idempotency_key ILIKE '%%' || $%d || '%%'", paramIdx))
		args = append(args, *filters.Search)
		paramIdx++
	}
	if filters.StartDate != nil {
		conditions = append(conditions, fmt.Sprintf("t.created_at >= $%d", paramIdx))
		args = append(args, *filters.StartDate)
		paramIdx++
	}
	if filters.EndDate != nil {
		conditions = append(conditions, fmt.Sprintf("t.created_at < $%d", paramIdx))
		args = append(args, *filters.EndDate)
		paramIdx++
	}

	extraWhere := ""
	if len(conditions) > 0 {
		extraWhere = " AND " + joinStrings(conditions, " AND ")
	}

	dataQuery := fmt.Sprintf(`
		SELECT
			t.id,
			t.idempotency_key,
			t.created_at,
			o.name,
			o.id,
			merchant_le.amount,
			COALESCE((
				SELECT fl.amount FROM ledger_entries fl
				JOIN accounts fa ON fa.id = fl.account_id
				WHERE fl.transaction_id = t.id
				  AND fl.direction = 'CREDIT'
				  AND fa.name = 'Platform Fee Revenue'
			), 0),
			merchant_le.currency
		FROM transactions t
		JOIN ledger_entries merchant_le ON merchant_le.transaction_id = t.id
		JOIN accounts merchant_acc ON merchant_acc.id = merchant_le.account_id
			AND merchant_acc.type = 'LIABILITY'
			AND merchant_le.direction = 'CREDIT'
		JOIN organizations o ON o.id = merchant_acc.organization_id
		WHERE 1=1%s
		ORDER BY t.created_at DESC
		LIMIT $%d
	`, extraWhere, paramIdx)

	// Count query (same joins and filters, no limit)
	countQuery := fmt.Sprintf(`
		SELECT COUNT(DISTINCT t.id)
		FROM transactions t
		JOIN ledger_entries merchant_le ON merchant_le.transaction_id = t.id
		JOIN accounts merchant_acc ON merchant_acc.id = merchant_le.account_id
			AND merchant_acc.type = 'LIABILITY'
			AND merchant_le.direction = 'CREDIT'
		JOIN organizations o ON o.id = merchant_acc.organization_id
		WHERE 1=1%s
	`, extraWhere)

	// Strip cursor condition from count args (cursor is only for pagination, not total)
	countArgs := args
	if cursor != nil {
		countArgs = args[1:] // skip the cursor arg
		// Rebuild extraWhere without cursor condition for count
		countConditions := conditions[1:]
		countExtraWhere := ""
		if len(countConditions) > 0 {
			// Re-number params starting from $1
			renumbered := make([]string, len(countConditions))
			for i, c := range countConditions {
				// Replace $N with $i+1
				renumbered[i] = renumberParam(c, i+1)
			}
			countExtraWhere = " AND " + joinStrings(renumbered, " AND ")
		}
		countQuery = fmt.Sprintf(`
			SELECT COUNT(DISTINCT t.id)
			FROM transactions t
			JOIN ledger_entries merchant_le ON merchant_le.transaction_id = t.id
			JOIN accounts merchant_acc ON merchant_acc.id = merchant_le.account_id
				AND merchant_acc.type = 'LIABILITY'
				AND merchant_le.direction = 'CREDIT'
			JOIN organizations o ON o.id = merchant_acc.organization_id
			WHERE 1=1%s
		`, countExtraWhere)
	}

	var total int
	err := pool.QueryRow(ctx, countQuery, countArgs...).Scan(&total)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("count query failed: %w", err)
	}

	dataArgs := append(args, limit+1)
	rows, err := pool.Query(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, nil, 0, err
	}
	defer rows.Close()

	var transactions []AdminTransaction
	for rows.Next() {
		var tx AdminTransaction
		err := rows.Scan(
			&tx.ID,
			&tx.IdempotencyKey,
			&tx.CreatedAt,
			&tx.MerchantName,
			&tx.MerchantID,
			&tx.Amount,
			&tx.Fee,
			&tx.Currency,
		)
		if err != nil {
			return nil, nil, 0, err
		}
		tx.Total = tx.Amount + tx.Fee
		transactions = append(transactions, tx)
	}

	if err := rows.Err(); err != nil {
		return nil, nil, 0, err
	}

	if len(transactions) == 0 {
		return []AdminTransaction{}, nil, total, nil
	}

	var nextCursor *time.Time
	if len(transactions) > limit {
		transactions = transactions[:limit]
		lastTimestamp := transactions[len(transactions)-1].CreatedAt
		nextCursor = &lastTimestamp
	}

	return transactions, nextCursor, total, nil
}

// GetAdminTransactionTotals returns aggregate metrics, respecting the same filters as the list query.
func GetAdminTransactionTotals(ctx context.Context, pool *pgxpool.Pool, filters AdminTransactionFilters) (AdminTotals, error) {
	paramIdx := 1
	var conditions []string
	var args []interface{}

	if filters.OrganizationID != nil {
		conditions = append(conditions, fmt.Sprintf("o.id = $%d", paramIdx))
		args = append(args, *filters.OrganizationID)
		paramIdx++
	}
	if filters.Search != nil {
		conditions = append(conditions, fmt.Sprintf("t.idempotency_key ILIKE '%%' || $%d || '%%'", paramIdx))
		args = append(args, *filters.Search)
		paramIdx++
	}
	if filters.StartDate != nil {
		conditions = append(conditions, fmt.Sprintf("t.created_at >= $%d", paramIdx))
		args = append(args, *filters.StartDate)
		paramIdx++
	}
	if filters.EndDate != nil {
		conditions = append(conditions, fmt.Sprintf("t.created_at < $%d", paramIdx))
		args = append(args, *filters.EndDate)
		paramIdx++
	}

	extraWhere := ""
	if len(conditions) > 0 {
		extraWhere = " AND " + joinStrings(conditions, " AND ")
	}

	// Fee uses a correlated subquery on t.id so it automatically respects the outer WHERE filters
	var totals AdminTotals
	query := fmt.Sprintf(`
		SELECT
			COUNT(DISTINCT t.id),
			COALESCE(SUM(merchant_le.amount), 0),
			COALESCE(SUM(
				(SELECT fl.amount FROM ledger_entries fl
				 JOIN accounts fa ON fa.id = fl.account_id
				 WHERE fl.transaction_id = t.id
				   AND fl.direction = 'CREDIT'
				   AND fa.name = 'Platform Fee Revenue')
			), 0),
			COUNT(DISTINCT o.id)
		FROM transactions t
		JOIN ledger_entries merchant_le ON merchant_le.transaction_id = t.id
		JOIN accounts merchant_acc ON merchant_acc.id = merchant_le.account_id
			AND merchant_acc.type = 'LIABILITY'
			AND merchant_le.direction = 'CREDIT'
		JOIN organizations o ON o.id = merchant_acc.organization_id
		WHERE 1=1%s
	`, extraWhere)

	err := pool.QueryRow(ctx, query, args...).Scan(&totals.TransactionCount, &totals.TotalVolume, &totals.TotalFees, &totals.MerchantCount)
	if err != nil {
		return AdminTotals{}, fmt.Errorf("totals query failed: %w", err)
	}
	// TotalVolume from the query is merchant_received; add fees for gross volume
	totals.TotalVolume = totals.TotalVolume + totals.TotalFees
	return totals, nil
}

// GetLedgerEntriesByTransactionID returns all ledger entries for a transaction,
// enriched with account name and type.
func GetLedgerEntriesByTransactionID(ctx context.Context, pool *pgxpool.Pool, transactionID string) ([]AdminLedgerEntry, error) {
	rows, err := pool.Query(ctx, `
		SELECT le.id, le.amount, le.direction, le.currency, a.name, a.type
		FROM ledger_entries le
		JOIN accounts a ON a.id = le.account_id
		WHERE le.transaction_id = $1
		ORDER BY le.direction DESC, a.name
	`, transactionID)
	if err != nil {
		return nil, fmt.Errorf("query ledger entries: %w", err)
	}
	defer rows.Close()

	var entries []AdminLedgerEntry
	for rows.Next() {
		var e AdminLedgerEntry
		if err := rows.Scan(&e.ID, &e.Amount, &e.Direction, &e.Currency, &e.AccountName, &e.AccountType); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if entries == nil {
		entries = []AdminLedgerEntry{}
	}
	return entries, nil
}

// Helper to join string slices.
func joinStrings(strs []string, sep string) string {
	result := ""
	for i, s := range strs {
		if i > 0 {
			result += sep
		}
		result += s
	}
	return result
}

// renumberParam replaces the first $N placeholder in s with $newIdx.
func renumberParam(s string, newIdx int) string {
	for i := 0; i < len(s)-1; i++ {
		if s[i] == '$' && s[i+1] >= '0' && s[i+1] <= '9' {
			end := i + 2
			for end < len(s) && s[end] >= '0' && s[end] <= '9' {
				end++
			}
			return s[:i] + fmt.Sprintf("$%d", newIdx) + s[end:]
		}
	}
	return s
}
