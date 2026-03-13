# dbEngine

Double-entry ledger engine and account management layer.

## Core invariant

**Every transaction must net to zero per currency.** If you debit 10 USDC somewhere, you must credit 10 USDC somewhere else. This is what keeps the books balanced.

```text
Deposit 10 USDC:

  DEBIT   10,000,000  Asset (platform wallet)     USDC
  CREDIT  10,000,000  Liability (user balance)    USDC
  ─────────────────────────────────────────────────────
  Net:             0                               OK
```

Amounts are positive integers in microunits (1 USDC = 1,000,000). Direction (`DEBIT`/`CREDIT`) determines sign. No signed amounts, no ambiguity.

## Files

| File | Purpose |
|------|---------|
| `engine.go` | `Connect(ctx, connStr)` — creates and pings a `pgxpool.Pool` |
| `models.go` | Go structs mirroring the Drizzle schema. `Currency`, `Direction`, and `AccountType` typed enums |
| `creation.go` | `CreateAccount` — insert any account type |
| `queries.go` | Read queries — list accounts, ledger entries, balances |
| `transaction.go` | `InsertTransaction` — zero-net enforced ledger writes |

## Transaction engine

### `InsertTransaction(ctx, pool, idempotencyKey, lines []LedgerLine) ([]LedgerEntry, error)`

Validates a batch of ledger lines, then atomically inserts them under a shared `transaction_id`. The caller-supplied `idempotencyKey` is stored in the `transactions` table under a unique constraint — retries with the same key return the existing entries instead of posting duplicates.

### Validation rules

Rules 1–5 run **before** touching the database. Rule 6 runs inside the DB transaction.

| # | Rule | Rejected with |
|---|------|---------------|
| 1 | Batch is empty | `transaction must have at least one line` |
| 2 | Amount <= 0 | `line N: amount must be positive, got X` |
| 3 | Invalid direction | `line N: invalid direction "X"` |
| 4 | Invalid currency | `line N: invalid currency "X"` |
| 5 | account_id is empty | `line N: account_id must be set` |
| 6 | Debits != credits for any currency | `transaction does not balance for X: debits=A credits=B` |
| 7 | Line currency != account currency | `line N: currency mismatch — line is X but account ID is Y` |

### Insert flow

1. Validate all lines (rules above)
2. `BEGIN` Postgres transaction
3. Insert into `transactions` with the caller's idempotency key (`ON CONFLICT DO NOTHING`)
4. If the key already existed, return the existing entries (retry-safe)
5. Verify each line's currency matches the referenced account's currency (rule 7)
6. Insert each line as a `ledger_entry` row referencing the new `transaction_id`
7. `COMMIT`

Failure at any step rolls back. Nothing partial hits the database.

## Models

### Account types

A single `accounts` table with a `type` enum:

- **ASSET** — things the platform owns (e.g. USDC wallet)
- **LIABILITY** — obligations to users (e.g. user balances)
- **EQUITY** — owner's equity
- **REVENUE** — income earned (e.g. fees collected)
- **EXPENSE** — costs incurred (e.g. fees paid)

### `LedgerLine` (input)

```go
type LedgerLine struct {
    Currency  Currency   // USD, USDC, ETH
    Amount    int64      // positive, in microunits
    Direction Direction  // DEBIT or CREDIT
    AccountID string     // references accounts.id
}
```

### `LedgerEntry` (output)

Same fields as `LedgerLine` plus `ID` and `TransactionID`, populated after insert.

## Queries

| Function | Description |
|----------|-------------|
| `CreateAccount(ctx, pool, name, type, currency, userID)` | Create an account of any type |
| `GetAllAccounts` | List all accounts |
| `GetAccountsByType(accountType)` | List accounts filtered by type |
| `GetAllLedgerEntries` | List all ledger entries ordered by transaction |
| `GetLedgerEntriesByTransaction(txID)` | Entries for a specific transaction |
| `GetAccountBalance(accountID, currency)` | Net balance (credits - debits) for any account |

## Schema

The TypeScript Drizzle schema in `dbSchema/schema.ts` is the source of truth. The Go structs here mirror those tables. When the schema changes, update `models.go` to match.
