import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function Architecture() {
  return (
    <>
      <Link href="/docs" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-8">
        <ArrowLeft className="w-4 h-4" />
        Back to Docs
      </Link>

      <article>
        <h1>Project Architecture</h1>
        
        <p>Understanding the structure and components of the Sangria x402 demo.</p>

        <h2>Project Structure</h2>

        <pre><code>{`sangria-net/
  main.py                  # Buyer client — checks balances, calls the paid endpoint
  merchant_server/
    __init__.py
    app.py                 # FastAPI app with the @pay-protected endpoint
    run.py                 # Entry point: python -m merchant_server.run
  wallet/
    __init__.py
    wallet.py              # TestnetWallet class — create, fund, and check wallets via CDP
  frontend/                # Next.js documentation and landing page
  guides-and-knowledge/    # Markdown documentation files
  .env                     # Environment variables (CDP credentials)
  pyproject.toml          # Python dependencies and project metadata`}</code></pre>

        <h2>Core Components</h2>

        <h3>1. Merchant Server (<code>merchant_server/</code>)</h3>

        <p>A FastAPI application that demonstrates a paid endpoint using the x402 protocol.</p>

        <p><strong>Key file: <code>app.py</code></strong></p>

        <pre><code>{`from fastapi import FastAPI
from fastapi_x402 import pay

app = FastAPI()

MERCHANT_ADDRESS = "0xF44c...fd39"

@app.get("/")
async def root():
    return {"status": "ok"}

@app.get("/premium")
@pay(
    amount_required=0.0001,  # $0.0001 USDC
    pay_to=MERCHANT_ADDRESS,
)
async def premium_endpoint():
    return {
        "message": "You accessed the premium endpoint!",
        "paid": True
    }`}</code></pre>

        <p>The <code>@pay</code> decorator from <code>fastapi-x402</code> handles:</p>
        
        <ul>
          <li>Returning 402 responses with payment requirements</li>
          <li>Verifying signed payment authorizations</li>
          <li>Settling payments via the Coinbase facilitator</li>
          <li>Adding payment receipts to response headers</li>
        </ul>

        <h3>2. Buyer Client (<code>main.py</code>)</h3>

        <p>A Python script that demonstrates how a client interacts with x402-protected endpoints.</p>

        <p><strong>Key responsibilities:</strong></p>
        
        <ul>
          <li>Initialize buyer and merchant wallets via CDP</li>
          <li>Check USDC balances before and after transactions</li>
          <li>Make HTTP requests to paid endpoints (x402 library handles payment negotiation automatically)</li>
          <li>Display transaction results</li>
        </ul>

        <p>The x402 client library transparently handles:</p>
        
        <ul>
          <li>Detecting 402 responses</li>
          <li>Signing ERC-3009 payment authorizations</li>
          <li>Retrying requests with payment headers</li>
        </ul>

        <h3>3. Wallet Management (<code>wallet/wallet.py</code>)</h3>

        <p>The <code>TestnetWallet</code> class provides utilities for interacting with the Coinbase Developer Platform.</p>

        <p><strong>Key methods:</strong></p>

        <pre><code>{`class TestnetWallet:
    @classmethod
    async def mint() -> TestnetWallet
        # Creates a new wallet on Base Sepolia
    
    async def fund_eth()
        # Requests testnet ETH for gas fees
    
    async def fund_usdc()
        # Requests testnet USDC (100 USDC)
    
    async def balance_usdc() -> Decimal
        # Checks current USDC balance
    
    async def export_private_key() -> str
        # Exports private key for signing payments`}</code></pre>

        <h2>Key Dependencies</h2>

        <table>
          <thead>
            <tr>
              <th>Package</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>cdp-sdk</code></td>
              <td>Coinbase Developer Platform SDK — wallet creation, funding, balance checks</td>
            </tr>
            <tr>
              <td><code>x402</code></td>
              <td>Client-side x402 protocol — signs USDC payments for 402 responses</td>
            </tr>
            <tr>
              <td><code>fastapi-x402</code></td>
              <td>Server-side x402 middleware — adds <code>@pay</code> decorator to protect endpoints</td>
            </tr>
            <tr>
              <td><code>uvicorn</code></td>
              <td>ASGI server to run FastAPI</td>
            </tr>
            <tr>
              <td><code>fastapi</code></td>
              <td>Modern Python web framework</td>
            </tr>
          </tbody>
        </table>

        <h2>Payment Flow Architecture</h2>

        <h3>High-level sequence:</h3>

        <ol>
          <li><strong>Client makes request</strong>: <code>main.py</code> sends GET request to <code>/premium</code></li>
          <li><strong>Server requires payment</strong>: FastAPI middleware returns 402 with payment details</li>
          <li><strong>Client signs authorization</strong>: x402 client library creates ERC-3009 signature</li>
          <li><strong>Client retries with payment</strong>: Request includes <code>X-PAYMENT</code> header</li>
          <li><strong>Server verifies</strong>: Calls Coinbase facilitator to verify signature and balance</li>
          <li><strong>Server settles</strong>: Facilitator submits transaction to Base Sepolia</li>
          <li><strong>Server responds</strong>: Returns content + transaction hash in <code>X-PAYMENT-RESPONSE</code> header</li>
        </ol>

        <h2>Wallet Management</h2>

        <p>
          The project uses pre-created wallets with addresses hardcoded in <code>main.py</code> and <code>merchant_server/app.py</code>. 
          This avoids needing to create and fund wallets every time you run the demo.
        </p>

        <h3>Creating new wallets:</h3>

        <pre><code>{`import asyncio
from wallet import TestnetWallet

async def setup():
    wallet = await TestnetWallet.mint()    # creates a new wallet
    await wallet.fund_eth()                # gas fees (free on testnet)
    await wallet.fund_usdc()               # payment token (free on testnet)
    print(wallet.address)                  # save this address

asyncio.run(setup())`}</code></pre>

        <p>Then update <code>MERCHANT_ADDRESS</code> and <code>BUYER_ADDRESS</code> in the code with your new addresses.</p>

        <h2>Important Security Notes</h2>

        <ul>
          <li><strong>CDP manages private keys server-side</strong>: The wallet secret in your <code>.env</code> encrypts them at rest — don't lose it or you lose access to your wallets</li>
          <li><strong>Private key export</strong>: The buyer's private key is exported from CDP only to sign x402 payment headers. This is the one place where the raw key is used locally</li>
          <li><strong>Testnet only</strong>: This demo runs on Base Sepolia testnet — all funds are fake, no real money is involved</li>
        </ul>

        <h2>Network Configuration</h2>

        <p>The demo uses <strong>Base Sepolia</strong> testnet:</p>
        
        <ul>
          <li><strong>Network</strong>: Base Sepolia (Ethereum L2 testnet)</li>
          <li><strong>Token</strong>: USDC (testnet version)</li>
          <li><strong>USDC Contract</strong>: <code>0x036CbD53842c5426634e7929541eC2318f3dCF7e</code></li>
          <li><strong>Facilitator</strong>: Coinbase hosted facilitator at <code>x402.org</code></li>
        </ul>

        <h2>Frontend Architecture</h2>

        <p>The documentation and landing page is built with Next.js:</p>

        <ul>
          <li><strong>Framework</strong>: Next.js 15 with App Router</li>
          <li><strong>Styling</strong>: Tailwind CSS with custom theme matching the original design</li>
          <li><strong>Documentation</strong>: React components with MDX support for markdown content</li>
          <li><strong>Icons</strong>: Lucide React for consistent iconography</li>
        </ul>

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
