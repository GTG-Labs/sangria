# Sangria Architecture

## Technical Architecture

Sangria uses a **hybrid stack** to bridge centralized fiat rails with decentralized settlement and HTTP-native payments.

### High-level layers

```
Client Layer (SDK)
	↓
Orchestration Layer (Backend)
	↓
Persistence Layer (DB)   +   Infrastructure Layer (Facilitator + Base)
	↓
Frontend (Docs + Merchant dashboard)
```

### Architecture diagram (from spec)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Sangria SDK  (Python / HTTPX extension)                             │   │
│  │  • 402 negotiation loop      • EIP-712 structured data signing       │   │
│  │  • ERC-3009 authorization    • Automatic retries                     │   │
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

| Layer | Technology | Responsibility |
| --- | --- | --- |
| **Client** | Python, HTTPX, x402, `eth_account` | 402 negotiation, EIP-712 signing, credit verification |
| **Orchestration** | Go, CDP SDK | Treasury wallets, mutexes, settlement, ledger management |
| **Persistence** | PostgreSQL, Drizzle ORM | User balances, API keys, audit logs |
| **Infrastructure** | Coinbase Facilitator, Base Blockchain | Gas-free settlement, on-chain USDC transfer |
| **Frontend** | Next.js 16, React 19, Tailwind CSS 4 | Merchant dashboard, documentation, auth |

### Component breakdown

#### Sangria SDK (Client Layer)

A Python client library extending HTTPX with x402 payment capabilities.

- `sangria.post()`, `sangria.get()`, etc. behave like normal HTTP calls.
- If an endpoint returns `402 Payment Required`, the SDK automatically:
    1. Reads payment terms from response headers.
    2. Verifies the user has sufficient Sangria Credits.
    3. Signs an **ERC-3009 TransferWithAuthorization** (EIP-712 typed data).
    4. Retries the request with the signed payment in the `X-PAYMENT` header.
- Supports both `exact` (fixed price) and `upto` (variable price) schemes.

**Key file:** `playground/main.py`

#### Sangria Backend (Orchestration Layer)

A Go-based service using `dbEngine` for server-side business logic.

- Accepts payment requests by validating incoming `X-PAYMENT` headers.
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

A Next.js documentation site and merchant dashboard.

- Current: landing page, docs, dark/light mode.
- Planned: login/auth, merchant API key management, wallet funding UI.

**Key files:** `frontend/app/page.tsx`, `frontend/app/docs/`
