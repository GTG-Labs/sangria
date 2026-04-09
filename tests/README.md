# Sangria Network - Comprehensive Test Suite

Production-grade testing infrastructure for the Sangria Network payment system, covering both TypeScript and Python SDKs with comprehensive security, financial, and end-to-end testing.

## 📁 Test Structure

```
tests/
├── unit/                          # Unit tests for core functionality
│   ├── typescript/                # TypeScript SDK unit tests
│   ├── python/                    # Python SDK unit tests
│   ├── crypto/                    # Cryptographic validation tests
│   ├── database/                  # Database persistence tests
│   ├── security/                  # Security penetration tests
│   ├── lifecycle/                 # Payment lifecycle tests
│   └── concurrency/              # Race condition & concurrency tests
├── security/                      # Security-focused test suites
├── financial/                     # Financial precision & compliance tests
├── e2e/                          # End-to-end integration tests
├── fixtures/                     # Test data and mock responses
└── utils/                        # Shared test utilities and setup
```

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Run all tests (143 tests covering TypeScript + Python)
pnpm test:all

# Run core tests (unit + security + financial)
pnpm test

# Run by category
pnpm test:unit          # All unit tests (TypeScript + Python)
pnpm test:unit:ts       # TypeScript SDK tests (28 tests)
pnpm test:unit:py       # Python SDK tests (50 tests)
pnpm test:security      # Security tests (33 tests)
pnpm test:financial     # Financial tests (21 tests)
pnpm test:e2e          # End-to-end tests (7 tests)
```

## 🧪 Test Categories

### **Unit Tests** (`/unit`)
- **TypeScript SDK**: Core client functionality, payment handling, error management
- **Python SDK**: Client, models, HTTP handling, FastAPI adapter integration
- **Crypto**: EIP-712 signatures, cryptographic validation
- **Database**: Payment persistence, state management, audit trails
- **Security**: Penetration testing, vulnerability assessments
- **Lifecycle**: Complete payment flow validation
- **Concurrency**: Race conditions, thread safety, load testing

### **Security Tests** (`/security`)
- EIP-712 signature security and replay attack prevention
- Payment validation and authorization enforcement
- Rate limiting and DoS protection
- Cryptographic integrity verification

### **Financial Tests** (`/financial`)
- USDC decimal precision handling
- Payment lifecycle state transitions
- Financial calculations and fee processing
- Compliance and audit trail validation

### **End-to-End Tests** (`/e2e`)
- Complete X402 payment flows
- Cross-SDK integration testing
- Real-world payment scenarios
- Performance and load testing

## ✨ Key Features

✅ **143 comprehensive tests** covering TypeScript and Python SDKs
✅ **Multi-language support** with consistent API across SDKs
✅ **Real cryptographic operations** using ethers.js and secure Python libraries
✅ **Production-grade database** with SQLite persistence and audit trails
✅ **Financial compliance** with complete payment lifecycle tracking
✅ **Security-first approach** with penetration testing and vulnerability assessment
✅ **CI/CD integration** with 90%+ coverage requirements

## 📊 Coverage & Quality

**Generate coverage reports:**
```bash
pnpm coverage         # Full coverage analysis
pnpm coverage:check   # Coverage with thresholds (90%+)
```

**Code quality:**
```bash
pnpm lint            # Lint all code (TypeScript + Python)
pnpm security:audit  # Security vulnerability scan
```

## 🔧 Development Commands

**Watch mode for active development:**
```bash
pnpm test:watch        # Watch mode for all tests
pnpm test:quick        # Fast core test run
```

**Specific test patterns:**
```bash
# Run specific test files
pnpm test:unit:ts --reporter=verbose
pnpm test:unit:py -v

# Run tests matching patterns
vitest run unit/typescript/core.test.ts
python -m pytest unit/python/test_client.py -v
```

## 🏗️ CI/CD Pipeline

The CI/CD pipeline runs comprehensive validation:

1. **Lint & Type Check** - Code quality validation
2. **Unit Tests** - TypeScript and Python SDK testing
3. **Security Tests** - Vulnerability and penetration testing
4. **Financial Tests** - Precision and compliance validation
5. **E2E Tests** - Integration and flow testing
6. **Security Audits** - Dependency vulnerability scanning
7. **Coverage Reports** - Test coverage analysis (90%+ required)

## 🐛 Troubleshooting

**Common issues:**

1. **Python virtual environment**: Ensure `venv` is activated for Python tests
   ```bash
   cd ../sdk/python && source venv/bin/activate
   ```

2. **Node version**: Use Node.js ≥18.0.0 for full compatibility
3. **pnpm version**: Use pnpm ≥8.0.0 for workspace features
4. **Port conflicts**: E2E tests use dynamic ports to avoid conflicts

**Debug modes:**
```bash
pnpm test:watch --reporter=verbose    # Detailed test output
pnpm test:unit:ts --reporter=verbose  # Verbose TypeScript testing
pnpm test:unit:py -v                 # Verbose Python testing
```

## 📚 Contributing

When adding new tests:
1. Follow the existing directory structure (`/unit`, `/security`, `/financial`, `/e2e`)
2. Add both positive and negative test cases
3. Include security and edge case validation
4. Update documentation and CI configuration
5. Ensure 90%+ test coverage for new code

## 🔧 Configuration Files

- `package.json` - NPM scripts and dependencies
- `vitest.config.ts` - Vitest test runner configuration
- `pnpm-workspace.yaml` - Workspace setup for multi-SDK testing
- `.github/workflows/ci.yml` - CI/CD pipeline configuration

## 📄 Documentation

- `TESTING.md` - Detailed testing strategies and methodologies
- `TODO.md` - Known issues and planned improvements
- Individual test files contain inline documentation

---

**Total Test Coverage**: 143 tests across TypeScript, Python, Security, Financial, and E2E suites
**Coverage Requirement**: 90%+ for all production code
**CI Status**: ✅ All tests passing with comprehensive security validation