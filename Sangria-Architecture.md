# Sangria Architecture

## Technical Architecture

Sangria uses a **hybrid stack** to bridge centralized fiat rails with decentralized settlement and HTTP-native payments.

### High-level layers

```text
Client Layer (SDK)
	↓
Orchestration Layer (Backend)
	↓
Persistence Layer (DB)   +   Infrastructure Layer (Facilitator + Base)
	↓
Frontend (Docs + Agent-operator dashboard)
```

### Architecture diagram (from spec)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Sangria SDK  (Python / HTTPX extension)                             │   │
│  │  • 402 negotiation loop      • External-wallet EIP-712 signing        │   │
│  │  • ERC-3009 (external only)  • Automatic retries                     │   │
│  │  • Credit balance check      • Future: Java, C#, Swift SDKs          │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATION LAYER                                │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Sangria Backend  (Go — dbEngine)                                    │   │
│  │  • Merchant treasury wallet management (CDP)                         │   │
│  │  • Treasury ERC-3009 auth signing (server-side)                      │   │
│  │  • Transaction mutex enforcement (anti-double-spend)                 │   │
│  │  • Payment verification & settlement via Facilitator                 │   │
│  │  • Internal fiat-to-credit ledger                                    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
                         │                         │
                         ▼                         ▼
┌──────────────────────────────┐   ┌──────────────────────────────────────────┐
│      PERSISTENCE LAYER       │   │           INFRASTRUCTURE LAYER            │
│  ┌────────────────────────┐  │   │  ┌──────────────────────────────────┐    │
│  │  PostgreSQL (Drizzle)  │  │   │  │  Facilitator  (Coinbase hosted)  │    │
│  │  • User credit balances│  │   │  │  • Signature verification        │    │
│  │  • Merchant API keys   │  │   │  │  • Gas sponsorship               │    │
│  │  • Audit transaction   │  │   │  │  • ERC-3009 on-chain settlement  │    │
│  │    logs                │  │   │  │    → Base Mainnet / Sepolia      │    │
│  └────────────────────────┘  │   │  └──────────────────────────────────┘    │
└──────────────────────────────┘   └──────────────────────────────────────────┘
```

### Layer descriptions

| Layer              | Technology                                 | Responsibility                                                                                                                  |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Client**         | TypeScript/Node, Python, SDK core/adapters | 402 negotiation, payload forwarding to orchestration layer, SDK integration (Next.js, Hono, Fastify, Express, FastAPI adapters) |
| **Orchestration**  | Go, CDP SDK                                | Treasury wallets, server-side ERC-3009 authorization signing, mutexes, settlement, ledger management                            |
| **Persistence**    | PostgreSQL, Drizzle ORM                    | User balances, API keys, audit logs                                                                                             |
| **Infrastructure** | Coinbase Facilitator, Base Blockchain      | Gas-free settlement, on-chain USDC transfer                                                                                     |
| **Frontend**       | Next.js 16, React 19, Tailwind CSS 4       | Agent-operator dashboard, documentation, auth                                                                                   |

### Component breakdown

#### Sangria SDK (Client Layer)

A TypeScript (and Python) **merchant-side** SDK for protecting API endpoints with x402 payment requirements.

- Wraps route handlers across Express, Fastify, Hono, Next.js, and FastAPI.
- On an incoming request **without** a payment header, the SDK calls the Sangria backend to generate payment requirements and returns a `402 Payment Required` response to the caller.
- On a retry **with** a `PAYMENT-SIGNATURE` header, the SDK forwards the signed payload to the Sangria backend's settle endpoint and, on success, passes the request through to the protected handler.
- Supports both `exact` (fixed price) and `upto` (variable price) schemes.
- Credit verification and client-side ERC-3009 signing are planned future capabilities, not part of the current SDK.

**Key files:** `sdk/merchants/sdk-typescript/src/core.ts`, `sdk/merchants/sdk-typescript/src/adapters/`

#### Sangria Backend (Orchestration Layer)

A Go-based service using `dbEngine` for server-side business logic.

- Accepts payment requests by validating incoming `PAYMENT-SIGNATURE` headers.
- Verifies and settles via the Coinbase Facilitator API.
- Manages treasury wallets via Coinbase CDP.
- Enforces transaction mutexes to prevent double-processing.
- Maintains an internal fiat-to-credit ledger.
- Uses a 300-second cache for expensive operations.

**Key files:** `backend/main.go`, `backend/dbEngine/`

#### x402 Merchant Server

A FastAPI app demonstrating x402-protected endpoints.

- `GET /` → Free health check
- `GET /premium` → $0.0001 USDC per request (exact)
- `GET /variable` → $0.0001–$0.0005 random price (exact)
- `POST /run` → Variable cost based on work performed (upto)

**Key file:** `playground/merchant_server/app.py`

#### Database (Persistence Layer)

PostgreSQL managed via Drizzle ORM, storing:

- Users (buyer accounts, wallet associations, credit balances)
- Merchants (profiles, API keys, treasury wallet addresses)
- Transactions (payment records, settlement receipts, tx hashes, audit log)

**Key files:** `dbSchema/schema.ts`, `dbSchema/drizzle.config.ts`

#### Facilitator (Infrastructure Layer)

Coinbase-hosted service that:

- Verifies ERC-3009 signature validity, wallet balance, and nonce freshness.
- Submits signed authorizations to the blockchain for settlement.
- Covers gas fees so the client pays $0 gas.

#### Frontend

A Next.js app split across two route groups: a public `(marketing)/` site (landing + docs) and an authenticated `(portal)/dashboard/` surface for the **agent operator** — the developer running an AI agent that spends through Sangria.

- Agent dashboard: balance, Stripe-powered top-ups, per-card spend caps, payment history. Lives at `/dashboard`, `/dashboard/cards`, `/dashboard/transactions`.
- WorkOS AuthKit for sign-in; CSRF-protected proxy routes forward to the Go backend.
- The legacy merchant-side surface (API key management, members, organizations, withdrawals) is parked in `frontend/app/(portal)/dashboard/_merchant/`. Next.js's leading-underscore convention keeps the folder out of the routing tree, so those pages aren't reachable today.

**Key files:** `frontend/app/(marketing)/page.tsx`, `frontend/app/(portal)/dashboard/ClientDashboardContent.tsx`. See [Agent-Dashboard.md](Agent-Dashboard.md) for the full route/component breakdown.
