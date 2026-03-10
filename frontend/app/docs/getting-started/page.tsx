import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function GettingStarted() {
  return (
    <>
      <Link href="/docs" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-8">
        <ArrowLeft className="w-4 h-4" />
        Back to Docs
      </Link>

      <article>
        <h1>Getting Started</h1>
        
        <p>
          This guide will walk you through setting up and running the Sangria x402 demo on your local machine.
        </p>

        <h2>Prerequisites</h2>
        
        <ul>
          <li>Python 3.10 or higher</li>
          <li><a href="https://docs.astral.sh/uv/">uv</a> (Python package manager)</li>
          <li>A <a href="https://portal.cdp.coinbase.com/">Coinbase Developer Platform</a> account</li>
        </ul>

        <h2>Installation</h2>

        <h3>1. Clone the repository</h3>
        
        <pre><code>{`git clone https://github.com/GTG-Labs/sangria-net.git
cd sangria-net`}</code></pre>

        <h3>2. Install dependencies</h3>
        
        <pre><code>uv sync</code></pre>

        <h3>3. Set up environment variables</h3>
        
        <p>Create a <code>.env</code> file from the example:</p>
        
        <pre><code>cp .env.example .env</code></pre>

        <p>Fill in your CDP credentials in <code>.env</code>:</p>
        
        <pre><code>{`CDP_API_KEY="your-api-key"
CDP_SECRET_KEY="your-secret-key"
CDP_WALLET_SECRET="your-wallet-secret"`}</code></pre>

        <p>
          You can get these from the <a href="https://portal.cdp.coinbase.com/">CDP Portal</a>. 
          The wallet secret is an encryption key you choose — CDP uses it to encrypt your wallet private keys on their servers.
        </p>

        <h2>Running the Demo</h2>

        <p>You'll need two terminal windows running simultaneously.</p>

        <h3>Terminal 1: Start the merchant server</h3>
        
        <pre><code>uv run python -m merchant_server.run</code></pre>

        <p>This starts a FastAPI server on <code>http://127.0.0.1:8000</code> with:</p>
        
        <ul>
          <li><code>GET /</code> — health check endpoint</li>
          <li><code>GET /premium</code> — costs $0.0001 USDC per request (protected by x402)</li>
        </ul>

        <h3>Terminal 2: Run the buyer client</h3>
        
        <pre><code>uv run python main.py</code></pre>

        <p>This will:</p>
        
        <ol>
          <li>Print initial USDC balances for both the merchant and buyer wallets</li>
          <li>Make a single paid request to <code>GET /premium</code></li>
          <li>Wait a few seconds for on-chain settlement</li>
          <li>Print final balances showing the USDC transfer</li>
        </ol>

        <h2>Example Output</h2>

        <pre><code>{`--- Initial Balances ---
  Merchant (0xF44c...fd39): 10.050000 USDC
  Buyer    (0x0b7b...e649):  9.950000 USDC

Status: 200 | Body: {'message': 'You accessed the premium endpoint!', 'paid': True}

Waiting for settlement...

--- Final Balances ---
  Merchant (0xF44c...fd39): 10.050100 USDC
  Buyer    (0x0b7b...e649):  9.949900 USDC`}</code></pre>

        <h2>What Just Happened?</h2>

        <ol>
          <li>The buyer client made an HTTP GET request to <code>/premium</code></li>
          <li>The server responded with <code>402 Payment Required</code></li>
          <li>The client's x402 library automatically signed a USDC payment authorization</li>
          <li>The client retried the request with the signed payment in the header</li>
          <li>The server verified the payment and returned the premium content</li>
          <li>The payment was settled on-chain (Base Sepolia testnet)</li>
          <li>Both wallets' balances were updated</li>
        </ol>

        <h2>Important Notes</h2>

        <ul>
          <li>This runs on <strong>Base Sepolia testnet</strong> — all funds are fake. No real money is involved.</li>
          <li>CDP manages private keys server-side. The wallet secret in your <code>.env</code> encrypts them at rest.</li>
          <li>The buyer's private key is exported from CDP only to sign x402 payment headers.</li>
        </ul>

        <h2>Next Steps</h2>

        <ul>
          <li><Link href="/docs/x402-protocol">Learn how the x402 protocol works</Link></li>
          <li><Link href="/docs/architecture">Explore the project architecture</Link></li>
          <li><Link href="/docs/variable-pricing">Implement variable pricing</Link></li>
        </ul>
      </article>
    </>
  );
}
