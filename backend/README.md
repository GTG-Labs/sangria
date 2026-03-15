# Sangria Backend

HTTP API server for accounts and transactions. Built with [Fiber](https://gofiber.io/) (Go) and [pgx](https://github.com/jackc/pgx) for Postgres.

## Prerequisites

- Go 1.25+
- A running Postgres instance with the schema already pushed (see [`dbSchema/README.md`](../dbSchema/README.md))

## Setup

```bash
cp .env.example .env   # fill in your DATABASE_URL
go build
go run .
```

The server starts on `http://localhost:3000`.

### Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string. Uses `sslmode=verify-full&sslrootcert=system` for certificate-verified encryption. See `.env.example` for details. |

## API reference

| Method | Path | Description |
|---|---|---|
| GET | `/` | Health check — returns `"Hello, Sangria!"` |
| POST | `/accounts` | Create an account |
| GET | `/accounts` | List all accounts |
| POST | `/transactions` | Create a transaction |
| GET | `/transactions` | List all transactions |

### Examples

```bash
# Health check
curl http://localhost:3000/

# Create an account
curl -X POST "http://localhost:3000/accounts" -H "Content-Type: application/json" -d '{"name":"Cash","type":"ASSET","currency":"USD"}'

# List all accounts
curl http://localhost:3000/accounts

# Create a transaction (from_account and to_account are account IDs)
curl -X POST "http://localhost:3000/transactions?from_account=1&to_account=2&value=100.50"

# List all transactions
curl http://localhost:3000/transactions
```

## Project structure

```
backend/
  main.go              # Entry point — Fiber app, route handlers, DB pool setup
  .env.example         # Template for DATABASE_URL
  dbEngine/
    engine.go          # Connect() — creates a pgxpool connection pool
    models.go          # Go structs mirroring the Drizzle schema (Account, Transaction)
    queries.go         # SQL queries — insert/select for accounts and transactions
```

### `dbEngine/` package

- **engine.go** — `Connect(ctx, connStr)` creates and pings a `pgxpool.Pool`.
- **models.go** — `Account` and `Transaction` structs with JSON tags. These mirror the tables defined in `dbSchema/schema.ts`.
- **queries.go** — `InsertAccount`, `GetAllAccounts`, `InsertTransaction`, `GetAllTransactions`. Raw SQL with parameterized queries.

## Adding a new table/endpoint

This project follows a **schema-first workflow** — the TypeScript Drizzle schema is the source of truth.

1. **Define the table** in `dbSchema/schema.ts`
2. **Push it** with `pnpm push` (from the `dbSchema/` directory)
3. **Add a Go struct** in `dbEngine/models.go` that mirrors the new table
4. **Add queries** in `dbEngine/queries.go` (insert, select, etc.)
5. **Add route handlers** in `main.go`

See [`dbSchema/README.md`](../dbSchema/README.md) for more on the schema workflow.
