# Sangria Frontend Security Documentation

## 🔒 Security Overview

This document outlines the comprehensive security implementation and best practices for the Sangria frontend application. The security architecture follows a defense-in-depth approach with multiple layers of protection for financial transactions and user data.

## 🚨 Recently Fixed Critical Vulnerabilities (April 2026)

### CRITICAL: CSRF Protection Bypass
- **Issue**: API routes were removing CSRF tokens but never validating them
- **Risk**: Complete bypass of CSRF protection for financial operations
- **Status**: ✅ **FIXED** - All POST endpoints now validate CSRF tokens before processing

### CRITICAL: Financial Transaction Security
- **Issue**: Withdrawal cancellation had no CSRF protection
- **Risk**: Attackers could cancel legitimate withdrawals
- **Status**: ✅ **FIXED** - All financial operations now require valid CSRF tokens

## 🛡️ Security Architecture

### 1. Content Security Policy (CSP)
- **Location**: `/proxy.ts` (Next.js middleware)
- **Implementation**: Nonce-based CSP with strict directives
- **Features**:
  - Unique nonce generation per request using `crypto.randomBytes(16)`
  - `default-src 'self'` - Only allow same-origin resources
  - `frame-ancestors 'none'` - Prevent clickjacking
  - `script-src` restricted to nonces and approved domains

```typescript
// CSP Header Generation
const nonce = crypto.randomBytes(16).toString('base64');
const cspHeader = `
  default-src 'self';
  script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://workoscdn.com;
  style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com;
  connect-src 'self' https://api.workos.com https://api.github.com;
  frame-ancestors 'none';
  upgrade-insecure-requests;
`;
```

### 2. CSRF Protection (Dual-Layer Architecture)
- **Client-side**: `/lib/csrf-protection.ts` - Token fetching and form integration
- **Server-side**: `/lib/csrf-server.ts` - Secure token generation and validation
- **Architecture**: Server-only token generation with HttpOnly cookies
- **Security**: Timing-safe comparison using `crypto.timingSafeEqual`
- **Tokens**: 32-byte cryptographically secure tokens from `crypto.randomBytes(32)`

#### Protected Endpoints:
- ✅ `/api/backend/withdrawals` - Financial withdrawals
- ✅ `/api/backend/withdrawals/[id]/cancel` - Withdrawal cancellations
- ✅ `/api/backend/organizations` - Organization creation
- ✅ `/api/backend/organizations/[id]/invitations` - User invitations
- ✅ `/api/backend/api-keys` - API key creation
- ✅ `/api/backend/accept-invitation` - Invitation acceptance

#### Implementation Pattern:
```typescript
// Server-side validation (required in all POST routes)
const isValidCSRF = await ServerCSRFProtection.validateRequestToken(clonedRequest);
if (!isValidCSRF) {
  return new Response(JSON.stringify({ error: "Invalid CSRF token" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
```

#### Token Flow Architecture:
1. **Server Generation**: Tokens generated server-side using `crypto.randomBytes(32)`
2. **HttpOnly Storage**: Tokens stored in HttpOnly cookies via `/api/csrf-token`
3. **Client Fetching**: Client fetches tokens via API and includes in requests
4. **Server Validation**: Server performs timing-safe comparison against cookie
5. **Session Scope**: Tokens valid for 1 hour, renewed on each request

### 3. Input Validation & Sanitization
- **Library**: Zod with custom security refinements
- **Location**: `/lib/validation.ts`
- **Features**:
  - XSS prevention using DOMPurify
  - Unicode normalization and homograph attack detection
  - Silent mutation prevention using `.superRefine()`
  - Comprehensive character set validation

#### Financial Input Validation:
```typescript
// Bulletproof currency validation
const safeCurrencyRegex = /^\d{1,8}(\.\d{1,2})?$/;

const withdrawalSchema = z.object({
  amount: z.string()
    .refine(val => safeCurrencyRegex.test(val.trim()))
    .refine(val => Number(val) > 0)
    .refine(val => Number(val) <= 100000) // Max $100,000
    .refine(val => Number(val) >= 0.01),  // Min $0.01
});
```

### 4. Authentication & Authorization
- **Provider**: WorkOS AuthKit with OAuth/SAML support
- **Session Management**: Server-side sessions with HttpOnly cookies
- **API Protection**: All API routes use `withAuth()` middleware
- **Multi-tenancy**: Organization-scoped access control

### 5. API Security
- **Proxy Pattern**: `/lib/api-proxy.ts`
- **Features**:
  - JWT token validation via WorkOS
  - 10-second request timeout protection
  - JSON structure validation before serialization
  - Prototype pollution prevention
  - Comprehensive error sanitization

## 💰 Financial Security Controls

### Withdrawal System Security
- **Amount Validation**: Regex-based validation blocking scientific notation
- **Balance Verification**: Server-side balance checks before processing
- **Merchant Validation**: UUID v4 validation for merchant IDs
- **Idempotency**: Unique keys prevent duplicate transactions
- **Audit Trail**: Complete transaction logging

### Transaction Display Security
- **Read-only Access**: Transaction viewing only, no modification
- **Microunit Precision**: Prevents floating-point arithmetic errors
- **Block Explorer Integration**: Transparent on-chain verification

## 🔐 Security Headers

### Middleware Headers (`/proxy.ts`)
```typescript
response.headers.set('Content-Security-Policy', cspHeader);
response.headers.set('x-nonce', nonce);
```

### Next.js Config Headers (`/next.config.ts`)
```typescript
{
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}
```

## 🚨 Security Monitoring & Alerts

### Development Security Checks
1. **TypeScript Strict Mode**: Enabled for compile-time security
2. **ESLint Security Rules**: Configured for common vulnerabilities
3. **Build Security**: Standalone output for secure containerization

### Runtime Security
1. **Request Validation**: All inputs validated before processing
2. **Error Handling**: Sanitized error messages prevent information disclosure
3. **Rate Limiting**: Client-side rate limiting with `useRateLimit` hook

## 🔧 Development Security Guidelines

### 1. Adding New API Endpoints
**REQUIRED**: All POST/PUT/DELETE endpoints must include CSRF validation:

```typescript
import { ServerCSRFProtection } from "@/lib/csrf-server";

export async function POST(request: Request) {
  // 1. Clone request to avoid consumption issues
  const clonedRequest = request.clone();

  // 2. Validate CSRF token FIRST
  const isValidCSRF = await ServerCSRFProtection.validateRequestToken(clonedRequest);
  if (!isValidCSRF) {
    return new Response(JSON.stringify({ error: "Invalid CSRF token" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Process request body and remove CSRF token
  const body = await request.json();
  const { csrf_token, ...sanitizedBody } = body;

  // 4. Continue with business logic
}
```

### 2. Client-side Form Security
**REQUIRED**: All forms must include CSRF tokens:

```typescript
import { useCSRFToken } from "@/lib/csrf-protection";

export function SecureForm() {
  const { addToJSON } = useCSRFToken();

  const handleSubmit = async (data) => {
    const response = await fetch('/api/endpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addToJSON(data)), // Automatically adds CSRF token
    });
  };
}
```

### 3. Input Validation Rules
**REQUIRED**: All user inputs must use Zod schemas from `/lib/validation.ts`:

```typescript
import { safeValidate, textInputSchema } from "@/lib/validation";

// Validate all inputs
const result = safeValidate(textInputSchema, userInput);
if (!result.success) {
  throw new Error(result.error);
}
```

## 🔍 Security Testing & Validation

### Build Testing
```bash
pnpm run build  # Must pass without security warnings
pnpm run lint   # Must pass security linting rules
```

### Security Checklist for New Features
- [ ] CSRF protection implemented for all state-changing operations
- [ ] Input validation using Zod schemas with security refinements
- [ ] XSS prevention through DOMPurify sanitization
- [ ] Authentication required for protected resources
- [ ] Error messages don't leak sensitive information
- [ ] No hardcoded secrets or credentials
- [ ] CSP nonce used for any inline scripts

## 🚨 Incident Response

### If Security Vulnerability Discovered:
1. **Immediate**: Document the vulnerability with affected endpoints
2. **Priority**: Implement CSRF validation if missing from any POST endpoint
3. **Validate**: Test fix with `pnpm run build` and manual testing
4. **Deploy**: Apply fix immediately to production
5. **Monitor**: Watch for successful/failed CSRF validations

### Security Contact
For security issues, create detailed reports including:
- Affected endpoints and request patterns
- Potential impact assessment
- Reproduction steps
- Suggested remediation

## 📚 Security Dependencies

### Core Security Libraries
- `zod`: Schema validation with security refinements
- `dompurify`: XSS prevention and HTML sanitization
- `validator`: Email and input validation
- `disposable-email-domains`: Disposable email detection
- `@hookform/resolvers`: Secure form validation integration

### Audit Commands
```bash
pnpm audit                    # Check for vulnerable dependencies
pnpm audit --audit-level high # High/critical vulnerabilities only
```

## 🎯 Security Roadmap

### Completed ✅
- CSRF protection for all financial operations with dual-layer architecture
- Server-only CSRF token generation with HttpOnly cookie storage
- Comprehensive input validation and sanitization
- Content Security Policy with nonce-based protection and strict-dynamic
- XSS prevention through DOMPurify integration
- Financial transaction security controls with microunit precision
- Stale closure fixes in security hooks
- React Hook Form optimization with memoized resolvers
- JSON serialization security with cycle detection

### Future Enhancements
- Server-side rate limiting with Redis
- Advanced threat detection and monitoring
- Automated security testing in CI/CD
- Regular security dependency audits
- Penetration testing for financial flows

---

**Last Updated**: April 20, 2026
**Security Review**: Complete comprehensive security audit with critical CSRF vulnerabilities fixed
**Next Review**: Recommend quarterly security audits for financial applications
