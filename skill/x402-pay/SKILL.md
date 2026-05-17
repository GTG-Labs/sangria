---
name: x402-pay
description: Make x402 payments to access paid API endpoints. Use when fetching a URL that returns 402 Payment Required, or when the user asks to "pay for" or "access" an x402-protected resource.
argument-hint: <url> [--method POST] [--body '{}'] [--headers '{}']
arguments: url
allowed-tools: Bash(npx *) Bash(pnpm *) Bash(security find-generic-password *)
---

# x402-pay

Makes a signed x402 payment to a paid API endpoint and returns the response. Handles the full flow: request, 402 detection, EIP-712 signing, retry with payment header. Supports both `exact` (fixed price) and `upto` (variable price) schemes automatically.

The private key is stored in macOS Keychain and read by the script at runtime. It never enters the conversation.

## Prerequisites

```!
security find-generic-password -s x402-agent-key -a x402 -w 2>/dev/null && echo "KEYCHAIN: CONFIGURED" || echo "KEYCHAIN: NOT_CONFIGURED"
```

```!
test -d "${CLAUDE_SKILL_DIR}/scripts/node_modules" && echo "DEPS: INSTALLED" || echo "DEPS: MISSING"
```

## Setup (only if NOT_CONFIGURED or MISSING above)

If **DEPS: MISSING**, install dependencies first:

```bash
pnpm install --prefix "${CLAUDE_SKILL_DIR}/scripts"
```

If **KEYCHAIN: NOT_CONFIGURED**, the user needs to store their private key. Tell them:

> Your x402 agent private key isn't configured yet. Please run this command — it will prompt you to paste your key securely (it won't be displayed):
>
> ```
> ! security add-generic-password -s x402-agent-key -a x402 -U -w
> ```
>
> The key should be a hex string with `0x` prefix. If you need to export one from CDP, run:
> `uv run python playground/agent-test/export-key.py <wallet-address>`

After the key is stored, run the setup check to verify balances and Permit2 approval:

```bash
npx --prefix "${CLAUDE_SKILL_DIR}/scripts" tsx "${CLAUDE_SKILL_DIR}/scripts/setup.ts"
```

If Permit2 is not approved (needed for `upto` scheme payments), run:

```bash
npx --prefix "${CLAUDE_SKILL_DIR}/scripts" tsx "${CLAUDE_SKILL_DIR}/scripts/setup.ts" --approve
```

Once setup outputs `"status": "ready"`, proceed to usage.

## Usage

Run the payment script with the target URL:

```bash
npx --prefix "${CLAUDE_SKILL_DIR}/scripts" tsx "${CLAUDE_SKILL_DIR}/scripts/x402-fetch.ts" "$url"
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--method` / `-m` | `GET` | HTTP method |
| `--body` / `-b` | none | JSON request body |
| `--headers` / `-H` | none | Extra headers as JSON object |

### Examples

```bash
# Simple GET to a paid endpoint
npx --prefix "${CLAUDE_SKILL_DIR}/scripts" tsx "${CLAUDE_SKILL_DIR}/scripts/x402-fetch.ts" "https://api.example.com/premium"

# POST with body and custom headers
npx --prefix "${CLAUDE_SKILL_DIR}/scripts" tsx "${CLAUDE_SKILL_DIR}/scripts/x402-fetch.ts" "https://api.example.com/search" \
  --method POST \
  --body '{"query": "test"}' \
  --headers '{"X-Custom": "value"}'
```

## Output Format

The script outputs a single JSON object to stdout. Parse it to determine the result.

**Success** (payment completed, resource returned):
```json
{
  "status": "success",
  "httpStatus": 200,
  "body": { "...resource data..." },
  "settlement": { "txHash": "0x...", "network": "eip155:8453", "payer": "0x..." },
  "payment": { "scheme": "exact", "amountMicro": 10000, "amountUSD": "0.010000" }
}
```

**No payment needed** (endpoint didn't return 402):
```json
{
  "status": "no_payment_required",
  "httpStatus": 200,
  "body": { "...response data..." }
}
```

**Error** (something went wrong):
```json
{
  "status": "error",
  "errorType": "INSUFFICIENT_BALANCE",
  "message": "human-readable explanation",
  "details": { "walletAddress": "0x...", "balanceUSDC": "0.5", "requiredUSDC": "1.0" }
}
```

## Error Handling

| errorType | Meaning | What to do |
|-----------|---------|-----------|
| `KEYCHAIN_ERROR` | Private key not in Keychain | Run the setup flow above |
| `INSUFFICIENT_BALANCE` | USDC balance too low | Tell the user to fund their wallet (address is in details) |
| `PERMIT2_NOT_APPROVED` | Permit2 not approved for USDC | Run `setup.ts --approve` |
| `PAYMENT_REJECTED` | Server rejected the signed payment | Report the error body to the user |
| `SIGNING_FAILED` | EIP-712 signing failed | Likely a library or chain mismatch — report to user |
| `NETWORK_ERROR` | Could not reach the URL | Check URL and network connectivity |
| `INVALID_ARGS` | Bad CLI arguments | Check the command format |

## Security Rules

These rules are non-negotiable:

1. **NEVER** attempt to read, display, or log the private key from Keychain
2. **NEVER** include the raw `PAYMENT-SIGNATURE` header value in conversation output
3. **NEVER** run `security find-generic-password -s x402-agent-key -w` directly — only the TypeScript script reads the key internally
4. **NEVER** ask the user to paste their private key into the chat — always direct them to use the `! security add-generic-password ...` command
5. All cryptographic operations happen inside `x402-fetch.ts` — the agent only sees the structured JSON output
