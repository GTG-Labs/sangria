# Sangria Frontend

**Secure financial application for HTTP-native micropayments with x402 protocol**

A Next.js frontend application with enterprise-grade security for handling real money transactions using USDC on Base Sepolia.

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
# Fill in required environment variables:
# - WORKOS_CLIENT_ID
# - WORKOS_API_KEY
# - NEXT_PUBLIC_WORKOS_REDIRECT_URI
# - BACKEND_URL
```

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
All POST/PUT/DELETE endpoints must validate CSRF tokens:

```typescript
import { ServerCSRFProtection } from "@/lib/csrf-server";

export async function POST(request: Request) {
  const clonedRequest = request.clone();
  const isValidCSRF = await ServerCSRFProtection.validateRequestToken(clonedRequest);
  if (!isValidCSRF) {
    return new Response(JSON.stringify({ error: "Invalid CSRF token" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Continue with business logic...
}
```

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
import { useCSRFToken } from "@/lib/csrf-protection";

const { addToJSON } = useCSRFToken();
const response = await fetch('/api/endpoint', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(addToJSON(formData)),
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

```bash
# Authentication (WorkOS)
WORKOS_CLIENT_ID=your_client_id
WORKOS_API_KEY=your_api_key
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/auth/callback

# Backend API
BACKEND_URL=http://localhost:8080

# Environment
NODE_ENV=development|production
```

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
