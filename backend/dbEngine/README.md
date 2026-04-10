# dbEngine

Double-entry ledger engine, account management, and database operations.

## Core invariant

**Every transaction must net to zero per currency.** If you debit 10 USD somewhere, you must credit 10 USD somewhere else. This is what keeps the books balanced.

```text
Payment settlement (cross-currency):

  DEBIT   100  Hot Wallet (USDC ASSET)          USDC
  CREDIT  100  Conversion Clearing              USDC
  ──────────────────────────────────────────────────
  USDC net:  0                                   OK

  DEBIT   100  Conversion Clearing              USD
  CREDIT   99  Merchant Payable (USD LIABILITY)  USD
  CREDIT    1  Platform Fee Revenue             USD
  ──────────────────────────────────────────────────
  USD net:   0                                   OK
```

Amounts are positive integers in microunits (1 USD = 1,000,000). Direction (`DEBIT`/`CREDIT`) determines sign. No signed amounts, no ambiguity.

## Files

| File | Purpose |
|------|---------|
| `engine.go` | `Connect(ctx, connStr)` — creates and pings a `pgxpool.Pool` |
| `models.go` | Go structs mirroring the Drizzle schema. Typed enums for Currency, Direction, AccountType, Network, WithdrawalStatus |
| `systemAccounts.go` | `EnsureSystemAccounts` — creates system-level accounts at startup (Conversion Clearing, Platform Fee Revenue, etc.) |
| `merchants.go` | `GetMerchantByID`, `EnsureUSDLiabilityAccount`, `GetMerchantUSDLiabilityAccount` |
| `cryptoWallets.go` | `CreateCryptoWalletWithAccount`, `GetWalletByNetwork`, `GetWalletByAddress` |
| `transaction.go` | `InsertTransaction` — zero-net enforced ledger writes with idempotency |
| `withdrawals.go` | `CreateWithdrawal`, `ApproveWithdrawal`, `RejectWithdrawal`, `CompleteWithdrawal`, `FailWithdrawal` |
| `users.go` | `UpsertUser`, `GetUserByWorkosID` |
| `queries.go` | Paginated transaction queries with cursor-based pagination |

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

## System accounts

Created automatically at startup via `EnsureSystemAccounts`:

| Account | Type | Currency | Purpose |
|---|---|---|---|
| Conversion Clearing | ASSET | USDC | Bridge: USDC side |
| Conversion Clearing | ASSET | USD | Bridge: USD side |
| Platform Fee Revenue | REVENUE | USD | Sangria's cut per transaction |
| Conversion Fees | EXPENSE | USD | Off-ramp fees (batch conversion) |
| Gas Fees | EXPENSE | USD | On-chain gas costs (future) |
| USD Merchant Pool | ASSET | USD | Pre-funded pool for merchant payouts |
| Owner Equity | EQUITY | USD | Capital deposited by Sangria |
| Withdrawal Clearing | ASSET | USD | Funds in transit during merchant payouts |

## Account types

A single `accounts` table with a `type` enum:

- **ASSET** — things the platform owns (e.g. USDC wallet, USD pool)
- **LIABILITY** — obligations to users (e.g. merchant USD balances)
- **EQUITY** — owner's equity (capital invested)
- **REVENUE** — income earned (e.g. platform fees)
- **EXPENSE** — costs incurred (e.g. conversion fees, gas)

## Models

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

## Schema

The TypeScript Drizzle schema in `dbSchema/schema.ts` is the source of truth. The Go structs here mirror those tables. When the schema changes, update `models.go` to match.
