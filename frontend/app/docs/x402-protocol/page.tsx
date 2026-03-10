import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function X402Protocol() {
  return (
    <>
      <Link href="/docs" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-8">
        <ArrowLeft className="w-4 h-4" />
        Back to Docs
      </Link>

      <article>
        <h1>x402 Protocol — How It Works</h1>
        
        <h2>What Is It?</h2>
        
        <p>
          x402 revives the HTTP 402 "Payment Required" status code — a code that's been in the HTTP spec since the 90s but was never actually used. 
          Coinbase built a real protocol around it: <strong>pay-per-request over HTTP using crypto (USDC)</strong>.
        </p>

        <p>
          The idea: any HTTP endpoint can require payment, and clients (apps, AI agents, whatever) can automatically pay and get access — no accounts, no API keys, no subscriptions.
        </p>

        <h2>The Full Flow (Step by Step)</h2>

        <pre><code>{`Client                          Server                      Facilitator (Coinbase)
  |                               |                               |
  |  1. GET /api/data             |                               |
  |------------------------------>|                               |
  |                               |                               |
  |  2. 402 Payment Required      |                               |
  |  + PAYMENT-REQUIRED header    |                               |
  |  (price, token, network,      |                               |
  |   payTo address, facilitator) |                               |
  |<------------------------------|                               |
  |                               |                               |
  |  3. Client signs payment      |                               |
  |  (ERC-3009 authorization)     |                               |
  |                               |                               |
  |  4. GET /api/data             |                               |
  |  + X-PAYMENT header           |                               |
  |------------------------------>|                               |
  |                               |  5. POST /verify              |
  |                               |  (forward signed payload)     |
  |                               |------------------------------>|
  |                               |                               |
  |                               |  6. "Payment is valid"        |
  |                               |<------------------------------|
  |                               |                               |
  |                               |  7. POST /settle              |
  |                               |  (submit to blockchain)       |
  |                               |------------------------------>|
  |                               |                               |
  |                               |  8. TX hash returned          |
  |                               |<------------------------------|
  |                               |                               |
  |  9. 200 OK + data             |                               |
  |  + X-PAYMENT-RESPONSE header  |                               |
  |  (TX hash as receipt)         |                               |
  |<------------------------------|                               |`}</code></pre>

        <ol>
          <li>Client makes a normal HTTP request</li>
          <li>Server says "this costs money" via a 402 response with payment details</li>
          <li>Client signs an ERC-3009 authorization (not a transaction — just a signature)</li>
          <li>Client retries the request with the signed payment in a header</li>
          <li>Server forwards the payment to the facilitator for verification</li>
          <li>Facilitator checks: valid signature? enough balance? nonce unused?</li>
          <li>Server asks the facilitator to settle (submit to blockchain)</li>
          <li>Facilitator submits the transaction on-chain and returns the TX hash</li>
          <li>Server returns the data + a receipt</li>
        </ol>

        <h2>The Three Headers</h2>

        <table>
          <thead>
            <tr>
              <th>Header</th>
              <th>Direction</th>
              <th>What it contains</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>PAYMENT-REQUIRED</code></td>
              <td>Server → Client</td>
              <td>"Here's what you need to pay" — price, token address, network, recipient wallet, facilitator URL</td>
            </tr>
            <tr>
              <td><code>X-PAYMENT</code></td>
              <td>Client → Server</td>
              <td>The signed payment authorization (ERC-3009 signature)</td>
            </tr>
            <tr>
              <td><code>X-PAYMENT-RESPONSE</code></td>
              <td>Server → Client</td>
              <td>Settlement receipt — the blockchain transaction hash</td>
            </tr>
          </tbody>
        </table>

        <h2>The 402 Response (What the Server Sends Back)</h2>

        <p>When you hit a paywalled endpoint without paying:</p>

        <pre><code>{`{
  "maxAmountRequired": "0.10",
  "resource": "/api/data",
  "description": "Access requires payment",
  "payTo": "0xABC...DEF",
  "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "network": "base-sepolia"
}`}</code></pre>

        <ul>
          <li><strong>maxAmountRequired</strong> — The price (in USDC, so $0.10)</li>
          <li><strong>payTo</strong> — The seller's wallet address (where the money goes)</li>
          <li><strong>asset</strong> — The token contract address (USDC's address on that chain)</li>
          <li><strong>network</strong> — Which blockchain to pay on</li>
        </ul>

        <h2>ERC-3009: TransferWithAuthorization</h2>

        <p>
          This is the clever part. Instead of the client actually <em>sending</em> a transaction (which would need ETH for gas), 
          x402 uses <strong>ERC-3009 "TransferWithAuthorization"</strong>.
        </p>

        <h3>How it works:</h3>

        <ol>
          <li><strong>Client signs a message</strong> (not a transaction) that says: "I authorize transferring X USDC from my wallet to wallet Y, valid between time A and time B, with nonce Z"</li>
          <li><strong>This signature gets sent in the <code>X-PAYMENT</code> header</strong> — it's just bytes, no blockchain involved yet</li>
          <li><strong>The facilitator</strong> takes that signature and submits it to the blockchain on your behalf</li>
          <li><strong>The USDC contract</strong> verifies the signature is valid and executes the transfer</li>
        </ol>

        <h3>Why this matters:</h3>

        <ul>
          <li><strong>The client never pays gas</strong> — the facilitator submits the transaction, so they cover the (tiny) gas fee</li>
          <li><strong>No on-chain transaction until the server is ready</strong> — the client just signs, the facilitator settles later</li>
          <li><strong>Replay protection</strong> — each authorization has a unique nonce and time window, so it can't be reused</li>
        </ul>

        <h3>Important limitation:</h3>

        <p>
          Currently <strong>only USDC supports ERC-3009</strong> (it was proposed by Circle, USDC's creator). 
          So despite x402 being theoretically token-agnostic, USDC is the only practical option right now.
        </p>

        <h2>The Facilitator</h2>

        <p>
          The facilitator is the middleman that handles the blockchain stuff so neither the client nor server has to. 
          Coinbase hosts one, but anyone could run one.
        </p>

        <p>It has two endpoints:</p>

        <ul>
          <li><strong><code>/verify</code></strong> — Checks: Is the signature valid? Does the wallet have enough USDC? Is the nonce unused? Is the time window valid?</li>
          <li><strong><code>/settle</code></strong> — Takes the signed authorization, submits it to the blockchain, waits for confirmation, returns the TX hash</li>
        </ul>

        <p>
          The server calls verify first, serves the content, then settles. This means the client gets their data fast and settlement happens alongside content delivery.
        </p>

        <h2>Server-Side Implementation</h2>

        <p>Adding x402 to a FastAPI server:</p>

        <pre><code>{`from fastapi import FastAPI
from fastapi_x402 import pay

app = FastAPI()

@app.get("/premium")
@pay(
    amount_required=0.0001,  # $0.0001 USDC
    pay_to="0xF44c...fd39",
)
async def premium_endpoint():
    return {
        "message": "You accessed the premium endpoint!",
        "paid": True
    }`}</code></pre>

        <p>The <code>@pay</code> decorator handles the 402 response, verification, and settlement automatically.</p>

        <h2>Payment Schemes</h2>

        <p>x402 defines different "schemes" — ways to structure payment:</p>

        <table>
          <thead>
            <tr>
              <th>Scheme</th>
              <th>Description</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>exact</strong></td>
              <td>Client pays a fixed, predetermined amount</td>
              <td>Production-ready</td>
            </tr>
            <tr>
              <td><strong>upto</strong></td>
              <td>Client authorizes a max amount, charged based on actual usage</td>
              <td>Supported in V2</td>
            </tr>
          </tbody>
        </table>

        <p>See <Link href="/docs/variable-pricing">Variable Pricing with x402</Link> for a deep dive on the "upto" scheme.</p>

        <h2>SDKs Available</h2>

        <ul>
          <li><strong>TypeScript</strong>: <code>@x402/core</code>, <code>@x402/evm</code>, <code>@x402/fetch</code>, <code>@x402/express</code>, <code>@x402/hono</code></li>
          <li><strong>Python</strong>: <code>pip install x402</code></li>
          <li><strong>Go</strong>: <code>github.com/coinbase/x402/go</code></li>
        </ul>

        <h2>TL;DR</h2>

        <p>
          x402 turns any HTTP endpoint into a pay-per-request paywall. Client hits endpoint → gets a 402 with a price → 
          signs an ERC-3009 authorization for USDC → sends it back → facilitator verifies and settles on-chain → 
          client gets data + a receipt. The whole thing fits inside a normal HTTP request/response cycle.
        </p>

        <h2>Resources</h2>

        <ul>
          <li><a href="https://docs.cdp.coinbase.com/x402/welcome">Coinbase x402 Documentation</a></li>
          <li><a href="https://github.com/coinbase/x402">x402 GitHub Repository</a></li>
          <li><a href="https://www.x402.org/">x402.org - Official Site</a></li>
          <li><a href="https://blog.quicknode.com/x402-protocol-explained-inside-the-https-native-payment-layer/">QuickNode - x402 Protocol Explained</a></li>
        </ul>
      </article>
    </>
  );
}
