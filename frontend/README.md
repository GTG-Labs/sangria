# Sangria Frontend

**Secure financial application for HTTP-native micropayments with x402 protocol**

A Next.js frontend application with enterprise-grade security for handling real money transactions using USDC on Base.

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+** (LTS recommended)
- **pnpm** (required - do not use npm or yarn)

### Installation
```bash
git clone [repository]
cd frontend
pnpm install
```

### Environment Setup
```bash
cp .env.example .env.local
# Fill in required environment variables — see § Environment Variables below.
```

All env var reads live in `lib/env.ts` (Zod-validated via `@t3-oss/env-nextjs`). Missing or malformed vars fail `pnpm build` with a clear validation error instead of shipping to production with a silent fallback. Add new env vars there, never directly via `process.env`.

### Development
```bash
pnpm run dev          # Start development server
pnpm run build        # Production build (test before deploy)
pnpm run lint         # Code linting
pnpm run type-check   # TypeScript validation
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## 🏗️ Architecture

### Technology Stack
- **Framework**: Next.js 16.1.6 with App Router
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS 4.x
- **Authentication**: WorkOS AuthKit (OAuth/SAML)
- **Forms**: React Hook Form + Zod validation
- **Security**: Multi-layer protection with CSRF, CSP, XSS prevention

### Project Structure

```text
frontend/
├── app/                          # Next.js App Router
│   ├── (marketing)/             # Public pages (landing, docs, blog)
│   ├── (portal)/dashboard/      # Authenticated application
│   │   ├── api-keys/           # API key management
│   │   ├── members/            # Organization members
│   │   ├── organizations/      # Organization management
│   │   ├── transactions/       # Transaction history
│   │   └── withdrawals/        # Financial withdrawals
│   └── api/backend/            # API proxy routes
├── lib/                         # Core utilities & security
├── components/                  # Reusable UI components
├── contexts/                    # React state management
└── proxy.ts                    # Security middleware (CSP + Auth)
```

## 🔐 Security Features

This application implements enterprise-grade security appropriate for financial operations:

- ✅ **CSRF Protection**: All state-changing operations protected
- ✅ **Input Validation**: Comprehensive Zod schemas with XSS prevention
- ✅ **Content Security Policy**: Nonce-based CSP with strict directives
- ✅ **Authentication**: WorkOS integration with server-side sessions
- ✅ **Financial Controls**: Bulletproof currency validation, microunit precision
- ✅ **API Security**: Request timeouts, JSON validation, error sanitization

**⚠️ CRITICAL**: See [SECURITY.md](./SECURITY.md) for complete security documentation.

## 💰 Financial Operations

### Withdrawal System
- **Amount Validation**: Regex-based validation blocking scientific notation
- **Balance Verification**: Real-time balance checks
- **Security**: CSRF protection + input sanitization
- **Precision**: Microunit handling prevents floating-point errors

### Transaction Tracking
- **Real-time Updates**: Live transaction monitoring
- **Block Explorer**: Transparent on-chain verification
- **Audit Trail**: Complete transaction history

## 🛡️ Development Security Guidelines

### Required for All New Features

#### 1. CSRF Protection (REQUIRED)

CSRF validation lives on the Go backend (`backend/auth/csrf_middleware.go` via double-submit cookie + `X-CSRF-Token` header). Do NOT add a second validation layer at the Next.js proxy route — it's been removed across all `app/api/backend/**` routes because it was redundant with the backend check and caused inconsistency (some routes had it, some didn't).

Proxy routes must forward the CSRF token to the backend. This happens automatically via `proxyToBackend` in `lib/api-proxy.ts`, which attaches both the `X-CSRF-Token` header AND a `Cookie: csrf_token=...` header so the Go middleware's double-submit check can match. Callers just need to pass the incoming `NextRequest` as the fourth argument:

```typescript
import { proxyToBackend } from "@/lib/api-proxy";

export async function POST(request: NextRequest) {
  const body = await request.json();
  // proxyToBackend forwards the CSRF header + cookie for you.
  return proxyToBackend("POST", "/internal/resource", { body }, request);
}
```

On the client, use `internalFetch` from `lib/fetch.ts` (not bare `fetch`) — it auto-attaches the `X-CSRF-Token` header for state-changing methods.

#### 2. Input Validation (REQUIRED)
All user inputs must use Zod schemas:

```typescript
import { safeValidate, withdrawalSchema } from "@/lib/validation";

const result = safeValidate(withdrawalSchema, userInput);
if (!result.success) {
  setError(result.error);
  return;
}
```

#### 3. Client-side CSRF (REQUIRED)
All forms must include CSRF tokens:

```typescript
import { internalFetch } from "@/lib/fetch";

const response = await internalFetch('/api/endpoint', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(formData),
});
```

## 🧪 Testing & Quality

### Pre-deployment Checklist
- [ ] `pnpm run build` - Must pass without errors
- [ ] `pnpm run lint` - Must pass without warnings
- [ ] `pnpm run type-check` - Must pass without errors
- [ ] All POST endpoints have CSRF validation
- [ ] All inputs use Zod validation schemas
- [ ] No hardcoded secrets or credentials

### Security Testing
```bash
pnpm audit                    # Check for vulnerable dependencies
pnpm audit --audit-level high # Critical/high vulnerabilities only
```

## 🚨 Critical Security Notes

### Recently Fixed (April 2026)
- **CSRF Protection Bypass**: All API routes now properly validate CSRF tokens
- **Financial Transaction Security**: All money operations require CSRF validation

### Security Requirements
1. **Never skip CSRF validation** on state-changing operations
2. **Always validate inputs** using Zod schemas from `/lib/validation.ts`
3. **Use microunit precision** for all currency calculations
4. **Test security** with build commands before deployment

## 📚 Documentation

- **[SECURITY.md](./SECURITY.md)**: Complete security implementation guide
- **Development**: Follow security patterns documented in this README
- **API Documentation**: See `/app/api/` route handlers for examples

## 🔧 Environment Variables

All env vars are validated at build time by `lib/env.ts` via `@t3-oss/env-nextjs` + Zod. `pnpm build` fails on any missing or malformed var — no silent localhost fallbacks reach production.

| Variable | Required | Scope | Description |
|---|---|---|---|
| `BACKEND_URL` | Yes | Server | Go backend base URL (e.g. `https://api.getsangria.com`). Must be a valid URL. |
| `BASE_URL` | Yes | Server | Public URL of this app, used by WorkOS AuthKit's OAuth callback (`app/auth/callback/route.ts`). Must be a valid URL. |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | Yes | Client | WorkOS redirect URI, inlined at build time. Must be a valid URL. |
| `WORKOS_CLIENT_ID` | Yes | Server | WorkOS client ID (consumed by AuthKit internally). |
| `WORKOS_API_KEY` | Yes | Server | WorkOS API key (consumed by AuthKit internally). |

**Adding a new var:** edit `lib/env.ts` — add it to the appropriate `server` or `client` schema block *and* to the `runtimeEnv` mapping (Next.js's build-time inlining requires the literal `process.env.NEXT_PUBLIC_X` reference there). Do not add `process.env` reads elsewhere.

## 🚀 Deployment

### Build for Production
```bash
pnpm run build     # Creates optimized standalone build
```

### Deployment Checklist
- [ ] All environment variables configured
- [ ] Build passes without errors
- [ ] Security headers properly configured
- [ ] HTTPS enabled (required for financial operations)

## 📞 Support

### Security Issues
- Review [SECURITY.md](./SECURITY.md) for security guidelines
- Follow incident response procedures for vulnerabilities

### Development Issues
- Ensure using `pnpm` (not npm/yarn)
- Check TypeScript strict mode compliance
- Verify CSRF protection on new endpoints

---

**Framework**: Next.js 16.1.6 | **Security**: Enterprise-grade | **Package Manager**: pnpm (required)
