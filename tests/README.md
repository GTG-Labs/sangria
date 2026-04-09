# Sangria.NET Testing Suite

Production-grade testing infrastructure for financial payment software.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run all core tests (87 tests, ~1 minute)
pnpm test

# Run specific categories
pnpm test:security    # Cryptographic & security tests (33 tests)
pnpm test:financial   # Financial precision tests (21 tests)
pnpm test:unit:ts     # TypeScript SDK tests (28 tests)
```

## Test Categories

- **🔐 Security & Crypto**: Real EIP-712 signatures, replay attack prevention, penetration testing
- **💰 Financial Precision**: USDC 6-decimal precision with Decimal.js, audit trails
- **⚡ Concurrency**: Race conditions, double-spending prevention, high-load testing
- **📊 Database**: SQLite persistence, audit compliance, state management
- **🔧 SDK**: TypeScript SDK functionality and API integration

## Key Features

✅ **87 comprehensive tests** covering all critical financial software requirements
✅ **Real cryptographic operations** using ethers.js (not mocked)
✅ **Production-grade database** with SQLite persistence and audit trails
✅ **Financial compliance** with complete payment lifecycle tracking
✅ **Attack simulation** covering security vulnerabilities
✅ **Sub-second feedback** for fast development cycles

## Documentation

See [TESTING.md](./TESTING.md) for comprehensive documentation, test architecture, and implementation details.

## Test Infrastructure

| Component | Purpose | Technology |
|-----------|---------|------------|
| CryptoValidator | EIP-712 signature operations | ethers.js + Decimal.js |
| PaymentDatabase | Production SQLite persistence | better-sqlite3 |
| Security Tests | Attack scenario validation | Real operations + Vitest |
| Concurrency Tests | Race condition testing | Promise-based concurrency |

This testing infrastructure ensures **production-ready validation** for financial software with cryptographic security, financial precision, and regulatory compliance.