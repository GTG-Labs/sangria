import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function Architecture() {
  return (
    <>
      <Link href="/docs" className="inline-flex items-center gap-2 text-zinc-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors mb-8">
        <ArrowLeft className="w-4 h-4" />
        Back to Docs
      </Link>

      <article>
        <h1>System Design &amp; Architecture</h1>

        <p>
          Sangria is a <strong>Digital Financial Bridge</strong> — a platform connecting fiat-funded digital
          wallets with the <strong>x402 HTTP-native payment protocol</strong>. It enables developers and AI
          agents to make programmatic micropayments using pre-funded Sangria Credits, while letting API
          merchants monetize without managing subscriptions or user accounts.
        </p>

        <h2>1. End-to-End Operational Flow</h2>

        <p>
          Sangria supports three distinct transaction scenarios depending on which parties are on the platform.
        </p>

        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Client</th>
              <th>Merchant</th>
              <th>Settlement Method</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Scenario 1</strong></td>
              <td>On Sangria (Credits)</td>
              <td>External (raw x402)</td>
              <td>Sangria Treasury pays USDC on-chain on client&apos;s behalf</td>
            </tr>
            <tr>
              <td><strong>Scenario 2</strong></td>
              <td>On Sangria (Credits)</td>
              <td>On Sangria (Credits)</td>
              <td>Internal ledger debit/credit — no blockchain</td>
            </tr>
            <tr>
              <td><strong>Scenario 3</strong></td>
              <td>External (raw wallet)</td>
              <td>On Sangria (Credits)</td>
              <td>On-chain USDC → Sangria converts to fiat for merchant</td>
            </tr>
          </tbody>
        </table>

        <h3>Scenario 1 — Client on Sangria, Merchant is External x402</h3>

        <p>
          The client funds a Sangria-powered digital wallet with Sangria Credits. The merchant is a raw x402
          endpoint with no Sangria account — they receive USDC directly on-chain.
        </p>

        <p>
          <strong>Key insight:</strong> The client never holds USDC. Sangria&apos;s{' '}
          <strong>Combined Treasury Wallet</strong> holds all the USDC and pays the merchant on the
          client&apos;s behalf. The client&apos;s Credits are purely the internal accounting layer —
          when a payment fires, Sangria spends Treasury USDC and deducts the equivalent Credits from the
          client&apos;s balance.
        </p>

        <h4>Phase I — On-Ramping (Credit Purchase)</h4>
        <ol>
          <li><strong>Wallet Funding</strong> — The User funds their Sangria digital wallet with fiat, which Sangria converts into internal Credits.</li>
          <li>
            <strong>Credit Issuance</strong> — Sangria updates its Internal Ledger, issuing{' '}
            <strong>Sangria Credits</strong> to the user&apos;s account and holds the equivalent USDC in
            the <strong>Combined Treasury Wallet</strong>.
          </li>
        </ol>

        <h4>Phase II — The x402 Request Loop</h4>
        <ol>
          <li>
            <strong>Initial Request</strong> — The User (via Sangria SDK) hits a protected endpoint (e.g.,{' '}
            <code>GET /premium</code>).
          </li>
          <li>
            <strong>402 Challenge</strong> — The Merchant Server returns{' '}
            <code>HTTP 402 Payment Required</code> with headers specifying the price, recipient address,
            and network.
          </li>
          <li>
            <strong>Credit Check &amp; Signature</strong> — The Sangria SDK verifies the user has sufficient
            Credits, then requests a backend-generated <strong>ERC-3009 TransferWithAuthorization</strong> signed
            server-side by the <strong>Treasury Wallet</strong> (via secure orchestration/key custody), never by
            client-side SDK keys, authorizing a transfer of Treasury USDC directly to the merchant.
          </li>
        </ol>

        <h4>Phase III — Settlement &amp; Data Delivery</h4>
        <ol>
          <li><strong>Payment Submission</strong> — The SDK retries with the Treasury-signed authorization in the <code>X-PAYMENT</code> header.</li>
          <li><strong>Verify &amp; Settle</strong> — The Merchant calls the <strong>Facilitator (Coinbase)</strong> to verify the Treasury signature and settle on Base.</li>
          <li><strong>Data Release</strong> — The Merchant receives USDC from Sangria&apos;s Treasury; the User receives the data and a TX hash.</li>
          <li><strong>Ledger Update</strong> — Sangria deducts the equivalent Credits from the User&apos;s internal balance.</li>
        </ol>

        <pre><code>{`User (Sangria SDK)   Sangria Treasury Wallet   Merchant Server   Facilitator   Base Blockchain
      │                       │                      │                 │               │
      │  1. GET /premium      │                      │                 │               │
      │────────────────────────────────────────────>│                 │               │
      │  2. HTTP 402          │                      │                 │               │
      │<────────────────────────────────────────────│                 │               │
      │  3. Check Credits     │                      │                 │               │
      │──────────────────────>│                      │                 │               │
      │                       │  Sign ERC-3009 auth  │                 │               │
      │                       │  (Treasury→Merchant) │                 │               │
      │<──────────────────────│                      │                 │               │
      │  4. Retry + X-PAYMENT │                      │                 │               │
      │  (Treasury signature) │                      │                 │               │
      │────────────────────────────────────────────>│                 │               │
      │                       │                      │  5. verify()    │               │
      │                       │                      │────────────────>│               │
      │                       │                      │  6. Valid ✓     │               │
      │                       │                      │<────────────────│               │
      │                       │                      │  7. settle()    │               │
      │                       │                      │────────────────>│               │
      │                       │                      │                 │  8. ERC-3009  │
      │                       │                      │                 │──────────────>│
      │                       │ Treasury USDC spent  │  9. USDC rcvd   │<──────────────│
      │                       │<─────────────────────┼─────────────────│               │
      │  10. 200 OK + data    │                      │                 │               │
      │<────────────────────────────────────────────│                 │               │
      │  11. Deduct Credits   │ (internal ledger)    │                 │               │
      │──────────────────────>│                      │                 │               │`}</code></pre>

        <h3>Scenario 2 — Both Client and Merchant are on Sangria</h3>

        <p>
          Both parties hold Sangria Credits. No blockchain interaction occurs. The entire transaction is an
          atomic internal ledger update — instant, gasless, and fully off-chain.
        </p>

        <ol>
          <li><strong>Request</strong> — The User hits a Sangria-registered endpoint.</li>
          <li><strong>Credit Check</strong> — Sangria Backend verifies the User has sufficient Credits.</li>
          <li>
            <strong>Atomic Ledger Update</strong> — Sangria debits the User&apos;s Credit balance and
            credits the Merchant&apos;s Credit balance in a single database transaction.
          </li>
          <li><strong>Data Release</strong> — The Merchant&apos;s endpoint returns the requested data.</li>
          <li><strong>Receipt</strong> — Both parties receive an internal transaction record.</li>
        </ol>

        <pre><code>{`User (Sangria SDK)        Sangria Backend            Merchant Server
      │                        │                           │
      │  1. GET /premium       │                           │
      │───────────────────────>│                           │
      │                        │  2. Check User Credits    │
      │                        │  3. Debit User,           │
      │                        │     Credit Merchant       │
      │                        │  (atomic DB transaction)  │
      │                        │──────────────────────────>│
      │                        │  4. 200 OK + data         │
      │                        │<──────────────────────────│
      │  5. Data + receipt     │                           │
      │<───────────────────────│                           │`}</code></pre>

        <p>
          <strong>No x402 negotiation, no blockchain, no gas.</strong> Sangria acts as a pure payment rail
          between two internal accounts.
        </p>

        <h3>Scenario 3 — Client is External, Merchant is on Sangria</h3>

        <p>
          The client is a raw x402 wallet (not on Sangria) paying in USDC. The merchant is on Sangria and
          wants to receive fiat, not USDC. Sangria acts as the receiving intermediary on the merchant&apos;s
          behalf.
        </p>

        <ol>
          <li>
            <strong>Standard x402 Request</strong> — The external client follows the normal x402 protocol,
            signing the <strong>ERC-3009 TransferWithAuthorization</strong> with its own wallet and paying USDC
            to <strong>Sangria&apos;s Combined Treasury Wallet</strong> on behalf of the merchant.
          </li>
          <li><strong>USDC Received</strong> — Sangria&apos;s treasury receives the USDC on-chain.</li>
          <li>
            <strong>USDC → Fiat Conversion</strong> — Sangria converts the received USDC to fiat via its
            off-ramp process.
          </li>
          <li>
            <strong>Fiat Deposit</strong> — Sangria deposits the fiat equivalent (minus Sangria&apos;s spread)
            into the Merchant&apos;s Sangria account balance.
          </li>
          <li><strong>Data Release</strong> — The merchant endpoint releases data to the client upon confirmation.</li>
        </ol>

        <pre><code>{`External Client      Merchant Server    Sangria Treasury    Merchant Sangria Acct
(raw x402 wallet)         │             (Combined Wallet)           │
      │                   │                    │                     │
      │  1. GET /premium  │                    │                     │
      │──────────────────>│                    │                     │
      │  2. HTTP 402      │                    │                     │
      │<──────────────────│                    │                     │
      │  3. Sign ERC-3009 │                    │                     │
      │  4. Retry+PAYMENT │                    │                     │
      │──────────────────>│                    │                     │
      │                   │  5. Settle to      │                     │
      │                   │     Sangria Wallet │                     │
      │                   │───────────────────>│                     │
      │                   │  6. USDC received  │                     │
      │                   │<───────────────────│                     │
      │  7. 200 OK + data │                    │  7. Convert USDC→Fiat
      │<──────────────────│                    │  8. Credit Merchant │
      │                   │                    │────────────────────>│`}</code></pre>

        <h2>2. Technical Architecture</h2>

        <p>Sangria utilizes a <strong>hybrid stack</strong> to manage the transition from centralized fiat to decentralized protocols.</p>

        <table>
          <thead>
            <tr>
              <th>Layer</th>
              <th>Technology</th>
              <th>Responsibility</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Client</strong></td>
              <td>Python, HTTPX, x402, eth_account</td>
              <td>402 negotiation, EIP-712 signing, credit verification</td>
            </tr>
            <tr>
              <td><strong>Orchestration</strong></td>
              <td>Go, CDP SDK</td>
              <td>Treasury wallets, mutexes, settlement, ledger management</td>
            </tr>
            <tr>
              <td><strong>Persistence</strong></td>
              <td>PostgreSQL, Drizzle ORM</td>
              <td>User balances, API keys, audit logs</td>
            </tr>
            <tr>
              <td><strong>Infrastructure</strong></td>
              <td>Coinbase Facilitator, Base Blockchain</td>
              <td>Gas-free settlement, on-chain USDC transfer</td>
            </tr>
            <tr>
              <td><strong>Frontend</strong></td>
              <td>Next.js 16, React 19, Tailwind CSS 4</td>
              <td>Merchant dashboard, documentation, auth</td>
            </tr>
          </tbody>
        </table>

        <h2>3. Component Breakdown</h2>

        <h3>Sangria SDK (Client Layer)</h3>
        <p>A Python client library extending HTTPX with x402 payment capabilities.</p>
        <ul>
          <li><code>sangria.get()</code>, <code>sangria.post()</code>, etc. behave like normal HTTP calls</li>
          <li>
            When an endpoint returns <code>402 Payment Required</code>, the SDK automatically:
            <ol>
              <li>Reads payment terms from the response headers</li>
              <li>Verifies the user has sufficient Sangria Credits</li>
              <li>For Sangria-credit flows (Scenario 1), requests a backend-generated <strong>ERC-3009 TransferWithAuthorization</strong> signed server-side by the <strong>Treasury Wallet</strong> via secure orchestration/key custody (not client-side keys)</li>
              <li>Retries the request with the signed payment in the <code>X-PAYMENT</code> header</li>
            </ol>
          </li>
          <li>Supports both <code>exact</code> (fixed price) and <code>upto</code> (variable price) schemes</li>
          <li>Future: external language SDKs in Java, C#, Swift</li>
        </ul>
        <p><strong>Key file:</strong> <code>playground/main.py</code></p>

        <h3>Sangria Backend (Orchestration Layer)</h3>
        <p>A Go-based service using <code>dbEngine</code> for server-side business logic.</p>
        <ul>
          <li><strong>Accept Payment Requests</strong> — Validates incoming <code>X-PAYMENT</code> headers</li>
          <li><strong>Verify &amp; Settle via Facilitator</strong> — Calls Coinbase&apos;s facilitator API</li>
          <li><strong>Treasury Wallet Management</strong> — Manages merchant receiving wallets via CDP</li>
          <li><strong>Transaction Mutexes</strong> — Prevents double-processing of concurrent payments</li>
          <li><strong>Internal Ledger</strong> — Tracks Sangria Credits per user account</li>
          <li><strong>Payment Caching</strong> — 300-second cache for expensive operations</li>
        </ul>
        <p><strong>Key files:</strong> <code>backend/main.go</code>, <code>backend/dbEngine/</code></p>

        <h3>x402 Merchant Server</h3>
        <p>A FastAPI application demonstrating x402-protected endpoints.</p>
        <pre><code>{`GET  /          → Free health check
GET  /premium   → $0.0001 USDC per request (exact scheme)
GET  /variable  → $0.0001–$0.0005 random price (exact scheme)
POST /run       → Variable cost based on work performed (upto scheme)`}</code></pre>
        <p><strong>Key file:</strong> <code>playground/merchant_server/app.py</code></p>

        <h3>Database (Persistence Layer)</h3>
        <p>PostgreSQL managed via <strong>Drizzle ORM</strong>, storing:</p>
        <ul>
          <li><strong>Users</strong> — Buyer accounts, wallet associations, credit balances</li>
          <li><strong>Merchants</strong> — Profiles, API keys, treasury wallet addresses</li>
          <li><strong>Transactions</strong> — Payment records, settlement receipts, tx hashes, audit log</li>
        </ul>
        <p><strong>Key files:</strong> <code>dbSchema/schema.ts</code>, <code>dbSchema/drizzle.config.ts</code></p>

        <h3>Facilitator (Infrastructure Layer)</h3>
        <p>Coinbase&apos;s hosted service that:</p>
        <ul>
          <li><strong>Verifies</strong> — Checks ERC-3009 signature validity, wallet balance, nonce freshness</li>
          <li><strong>Settles</strong> — Submits signed authorization to the blockchain</li>
          <li><strong>Covers gas</strong> — Pays transaction gas fees so the client pays zero gas</li>
        </ul>

        <h3>Frontend</h3>
        <p>A Next.js documentation site and merchant dashboard.</p>
        <ul>
          <li><strong>Current:</strong> Landing page, docs, dark/light mode</li>
          <li><strong>Planned:</strong> Login &amp; authentication, merchant API key management, wallet funding UI</li>
        </ul>
        <p><strong>Key files:</strong> <code>frontend/app/page.tsx</code>, <code>frontend/app/docs/</code></p>

        <h2>4. Business &amp; Revenue Model</h2>

        <p>Sangria monetizes the friction between traditional cash and autonomous agentic payments.</p>

        <h3>Revenue Streams</h3>
        <table>
          <thead>
            <tr>
              <th>Stream</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Transaction Spread</strong></td>
              <td>Charge a margin on Credits vs. raw on-chain USDC cost (e.g., sell $1.00 of credits for $1.10 in cash)</td>
            </tr>
            <tr>
              <td><strong>Facilitator Management</strong></td>
              <td>Charge merchants a flat monthly SaaS fee to manage Coinbase Facilitator API &amp; gas sponsorship</td>
            </tr>
            <tr>
              <td><strong>Breakage</strong></td>
              <td>Revenue from unused or expired small-balance credits</td>
            </tr>
          </tbody>
        </table>

        <h3>Target Actors</h3>
        <table>
          <thead>
            <tr>
              <th>Actor</th>
              <th>Role</th>
              <th>Integration</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Merchant</strong></td>
              <td>API providers (LLMs, data scrapers) wanting per-request monetization</td>
              <td><strong>Sangria Python API</strong> (server-side)</td>
            </tr>
            <tr>
              <td><strong>User</strong></td>
              <td>Developers or AI Agents making programmatic micropayments</td>
              <td><strong>Sangria Python SDK</strong> (client-side)</td>
            </tr>
          </tbody>
        </table>

        <h2>5. 2026 Compliance &amp; Risk Mitigation</h2>

        <table>
          <thead>
            <tr>
              <th>Risk Category</th>
              <th>Mitigation Strategy</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Regulatory</strong></td>
              <td>Maintain CA DFAL License and FinCEN MSB registration; hold all &ldquo;Credit&rdquo; value in segregated statutory trusts</td>
            </tr>
            <tr>
              <td><strong>Taxation</strong></td>
              <td>Automate Form 1099-DA generation for every on-chain disposal; track state-level Economic Nexus thresholds</td>
            </tr>
            <tr>
              <td><strong>Financial</strong></td>
              <td>Maintain a liquid USDC Treasury to satisfy 100% of issued credits at all times (prevent liquidity runs)</td>
            </tr>
            <tr>
              <td><strong>Security</strong></td>
              <td>Utilize CDP Wallet Secrets for server-side signing; enforce unique Nonces per ERC-3009 authorization to prevent replay attacks</td>
            </tr>
          </tbody>
        </table>

        <h2>6. Protocols &amp; Standards</h2>

        <table>
          <thead>
            <tr>
              <th>Protocol</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>x402</strong></td>
              <td>HTTP-native payment protocol using the <code>402 Payment Required</code> status code</td>
            </tr>
            <tr>
              <td><strong>ERC-3009</strong></td>
              <td>USDC standard for gasless <code>TransferWithAuthorization</code> — allows third parties to submit pre-signed transfers</td>
            </tr>
            <tr>
              <td><strong>EIP-712</strong></td>
              <td>Typed structured data signing — the format used to sign ERC-3009 authorizations</td>
            </tr>
          </tbody>
        </table>

        <h3>Payment Schemes</h3>
        <table>
          <thead>
            <tr>
              <th>Scheme</th>
              <th>Description</th>
              <th>Use Case</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>exact</strong></td>
              <td>Fixed price known before the request</td>
              <td>Simple API calls, static content</td>
            </tr>
            <tr>
              <td><strong>upto</strong></td>
              <td>Maximum price set upfront; actual price determined after work is done</td>
              <td>LLM inference, automation, variable-cost operations</td>
            </tr>
          </tbody>
        </table>

        <h2>7. Security Considerations</h2>

        <ul>
          <li><strong>CDP key management</strong> — Private keys stored server-side by Coinbase, encrypted with <code>CDP_WALLET_SECRET</code>. Losing the secret = losing wallet access.</li>
          <li><strong>Scenario-specific signing</strong> — In Scenario 1, <strong>ERC-3009 TransferWithAuthorization</strong> is signed server-side by the <strong>Treasury Wallet</strong> through secure orchestration/key custody; in Scenario 3, the external client signs with its own wallet.</li>
          <li><strong>Nonce protection</strong> — Each ERC-3009 authorization has a unique nonce, preventing replay attacks.</li>
          <li><strong>Transaction mutexes</strong> — Prevent double-settlement of concurrent payment requests.</li>
          <li><strong>Facilitator trust</strong> — Coinbase operates the facilitator; it must be trusted to verify and settle honestly.</li>
          <li><strong>Segregated reserves</strong> — All user Credits are backed 1:1 by USDC held in trust to prevent insolvency.</li>
        </ul>

        <h2>8. Network &amp; Contract Details</h2>

        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Network (Production)</td>
              <td>Base Mainnet</td>
            </tr>
            <tr>
              <td>Network (Development)</td>
              <td>Base Sepolia (testnet)</td>
            </tr>
            <tr>
              <td>USDC Contract (Sepolia)</td>
              <td><code>0x036CbD53842c5426634e7929541eC2318f3dCF7e</code></td>
            </tr>
            <tr>
              <td>Playground Merchant Wallet</td>
              <td><code>0xF44cc4b82470Eb3D1fDAc83b8b7226d7cD07fd39</code></td>
            </tr>
            <tr>
              <td>Playground Buyer Wallet</td>
              <td><code>0x0b7b1E88e321C3f326776e35C042bb3d035Be649</code></td>
            </tr>
            <tr>
              <td>Settlement Time</td>
              <td>~3 seconds</td>
            </tr>
            <tr>
              <td>Gas Cost to Client</td>
              <td>$0 (facilitator covers gas)</td>
            </tr>
          </tbody>
        </table>

        <h2>Next Steps</h2>

        <ul>
          <li><Link href="/docs/getting-started">Get started with the demo</Link></li>
          <li><Link href="/docs/x402-protocol">Learn about the x402 protocol</Link></li>
          <li><Link href="/docs/variable-pricing">Explore variable pricing</Link></li>
        </ul>
      </article>
    </>
  );
}
