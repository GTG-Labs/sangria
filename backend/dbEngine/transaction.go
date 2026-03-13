package dbengine

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrDuplicateTransaction is returned when a transaction with the same
// idempotency key has already been committed.
var ErrDuplicateTransaction = errors.New("duplicate transaction")

// validCurrencies is the set of currencies accepted by the ledger.
var validCurrencies = map[Currency]bool{
	USD: true, USDC: true, ETH: true,
}

// validDirections is the set of directions accepted by the ledger.
var validDirections = map[Direction]bool{
	Debit: true, Credit: true,
}

// InsertTransaction validates a batch of ledger lines for double-entry
// correctness (zero-net per currency) and atomically inserts them as a
// single transaction. The caller-supplied idempotencyKey is stored under a
// unique constraint so that retries with the same key return the existing
// entries instead of posting duplicate movements.
func InsertTransaction(ctx context.Context, pool *pgxpool.Pool, idempotencyKey string, lines []LedgerLine) ([]LedgerEntry, error) {
	if idempotencyKey == "" {
		return nil, fmt.Errorf("idempotency key must not be empty")
	}
	if err := validateLines(lines); err != nil {
		return nil, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) // safe: if Commit() already fired, Rollback() is a no-op

	// Insert into transactions table; the unique constraint on
	// idempotency_key prevents duplicate ledger writes.
	var txnID string
	err = tx.QueryRow(ctx,
		`INSERT INTO transactions (idempotency_key)
		 VALUES ($1)
		 ON CONFLICT (idempotency_key) DO NOTHING
		 RETURNING id`,
		idempotencyKey,
	).Scan(&txnID)

	if errors.Is(err, pgx.ErrNoRows) {
		// Idempotency key already exists — return existing entries.
		tx.Rollback(ctx)
		return getExistingEntries(ctx, pool, idempotencyKey)
	}
	if err != nil {
		return nil, fmt.Errorf("insert transaction: %w", err)
	}

	// Verify each line's currency matches its referenced account.
	if err := validateAccountCurrencies(ctx, tx, lines); err != nil {
		return nil, err
	}

	entries := make([]LedgerEntry, len(lines))
	for i, line := range lines {
		var e LedgerEntry
		err := tx.QueryRow(ctx,
			`INSERT INTO ledger_entries
			   (transaction_id, currency, amount, direction, account_id)
			 VALUES ($1, $2, $3, $4, $5)
			 RETURNING id, transaction_id, currency, amount, direction, account_id`,
			txnID, line.Currency, line.Amount, line.Direction, line.AccountID,
		).Scan(
			&e.ID, &e.TransactionID, &e.Currency, &e.Amount, &e.Direction,
			&e.AccountID,
		)
		if err != nil {
			return nil, fmt.Errorf("insert ledger entry %d: %w", i, err)
		}
		entries[i] = e
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	return entries, nil
}

// getExistingEntries fetches ledger entries for a previously committed
// transaction identified by its idempotency key.
func getExistingEntries(ctx context.Context, pool *pgxpool.Pool, idempotencyKey string) ([]LedgerEntry, error) {
	rows, err := pool.Query(ctx,
		`SELECT le.id, le.transaction_id, le.currency, le.amount, le.direction,
		        le.account_id
		 FROM ledger_entries le
		 JOIN transactions t ON t.id = le.transaction_id
		 WHERE t.idempotency_key = $1`,
		idempotencyKey,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch existing entries: %w", err)
	}
	defer rows.Close()

	var entries []LedgerEntry
	for rows.Next() {
		var e LedgerEntry
		if err := rows.Scan(
			&e.ID, &e.TransactionID, &e.Currency, &e.Amount, &e.Direction,
			&e.AccountID,
		); err != nil {
			return nil, fmt.Errorf("scan existing entry: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// validateAccountCurrencies checks that each line's currency matches
// the currency of the referenced account. Runs inside the DB transaction
// so the account rows are read under the same snapshot.
func validateAccountCurrencies(ctx context.Context, tx pgx.Tx, lines []LedgerLine) error {
	for i, line := range lines {
		var acctCurrency Currency
		err := tx.QueryRow(ctx,
			`SELECT currency FROM accounts WHERE id = $1`,
			line.AccountID,
		).Scan(&acctCurrency)
		if err != nil {
			return fmt.Errorf("line %d: account lookup: %w", i, err)
		}
		if acctCurrency != line.Currency {
			return fmt.Errorf(
				"line %d: currency mismatch — line is %s but account %s is %s",
				i, line.Currency, line.AccountID, acctCurrency,
			)
		}
	}
	return nil
}

// validateLines runs all pre-insert checks on the batch of lines.
func validateLines(lines []LedgerLine) error {
	if len(lines) == 0 {
		return fmt.Errorf("transaction must have at least one line")
	}

	for i, line := range lines {
		if line.Amount <= 0 {
			return fmt.Errorf("line %d: amount must be positive, got %d", i, line.Amount)
		}
		if !validDirections[line.Direction] {
			return fmt.Errorf("line %d: invalid direction %q", i, line.Direction)
		}
		if !validCurrencies[line.Currency] {
			return fmt.Errorf("line %d: invalid currency %q", i, line.Currency)
		}
		if line.AccountID == "" {
			return fmt.Errorf("line %d: account_id must be set", i)
		}
	}

	return validateZeroNet(lines)
}

// validateZeroNet checks that debits and credits balance to zero for each currency.
func validateZeroNet(lines []LedgerLine) error {
	type balance struct {
		debits  int64
		credits int64
	}

	byCurrency := make(map[Currency]*balance)

	for _, line := range lines {
		b, ok := byCurrency[line.Currency]
		if !ok {
			b = &balance{}
			byCurrency[line.Currency] = b
		}
		switch line.Direction {
		case Debit:
			b.debits += line.Amount
		case Credit:
			b.credits += line.Amount
		}
	}

	for cur, b := range byCurrency {
		if b.debits != b.credits {
			return fmt.Errorf(
				"transaction does not balance for %s: debits=%d credits=%d",
				cur, b.debits, b.credits,
			)
		}
	}

	return nil
}
