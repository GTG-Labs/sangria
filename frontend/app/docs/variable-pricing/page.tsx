import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function VariablePricing() {
  return (
    <>
      <Link href="/docs" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-8">
        <ArrowLeft className="w-4 h-4" />
        Back to Docs
      </Link>

      <article>
        <h1>Variable Pricing with x402 — The "upto" Scheme</h1>
        
        <blockquote>
          <strong>Prerequisite:</strong> Read <Link href="/docs/x402-protocol">x402 Protocol — How It Works</Link> first.
        </blockquote>

        <h2>The Problem</h2>

        <p>With the <strong>"exact"</strong> scheme, the price is fixed upfront:</p>
        
        <ul>
          <li>Client asks for resource → server says "that's $0.10" → client pays exactly $0.10</li>
        </ul>

        <p>
          But for an LLM API, <strong>you don't know the cost until the work is done</strong>. A short response might use 50 tokens ($0.0005), 
          a long one might use 5,000 tokens ($0.05). You can't charge a fixed price without either overcharging or undercharging.
        </p>

        <h2>The Solution: "upto" Scheme</h2>

        <p>
          The "upto" scheme splits the payment flow into <strong>two steps</strong>: <strong>verify</strong> first, <strong>settle</strong> later.
        </p>

        <p>The client authorizes a <strong>maximum</strong> amount, but only gets charged for what they actually used.</p>

        <h2>The Full Flow</h2>

        <pre><code>{`Client                          Server                      Facilitator
  |                               |                               |
  |  1. POST /api/llm             |                               |
  |  body: { query: "..." }       |                               |
  |------------------------------>|                               |
  |                               |                               |
  |  2. 402 Payment Required      |                               |
  |  scheme: "upto"               |                               |
  |  price: "$0.10" (MAX)         |                               |
  |  minPrice: "$0.01" (MIN)      |                               |
  |<------------------------------|                               |
  |                               |                               |
  |  3. Client signs authorization|                               |
  |  for UP TO $0.10              |                               |
  |                               |                               |
  |  4. POST /api/llm             |                               |
  |  + X-PAYMENT header           |                               |
  |------------------------------>|                               |
  |                               |                               |
  |                               |  5. verifyPayment()           |
  |                               |  "Can this wallet pay up to   |
  |                               |   $0.10? Is the sig valid?"   |
  |                               |------------------------------>|
  |                               |                               |
  |                               |  6. "Yes, verified"           |
  |                               |<------------------------------|
  |                               |                               |
  |                 7. NOW do the expensive work                   |
  |                    Run the LLM, count tokens                  |
  |                    Result: 2,000 tokens used                  |
  |                    Actual cost: $0.02                          |
  |                               |                               |
  |                               |  8. settlePayment()           |
  |                               |  price: $0.02 (ACTUAL)        |
  |                               |------------------------------>|
  |                               |                               |
  |                               |  9. Settles $0.02 on-chain    |
  |                               |  (not the full $0.10)         |
  |                               |<------------------------------|
  |                               |                               |
  |  10. 200 OK + LLM response    |                               |
  |<------------------------------|                               |`}</code></pre>

        <p>
          The critical difference: the server <strong>verifies</strong> the client can pay before doing work, 
          then <strong>settles</strong> for the actual cost after the work is done.
        </p>

        <h2>exact vs upto — Side by Side</h2>

        <table>
          <thead>
            <tr>
              <th></th>
              <th>exact</th>
              <th>upto</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Price known?</strong></td>
              <td>Yes, upfront</td>
              <td>No, determined after work</td>
            </tr>
            <tr>
              <td><strong>Client authorizes</strong></td>
              <td>Exact amount</td>
              <td>Maximum amount</td>
            </tr>
            <tr>
              <td><strong>Server flow</strong></td>
              <td><code>settlePayment()</code> (one step)</td>
              <td><code>verifyPayment()</code> → do work → <code>settlePayment()</code> (two steps)</td>
            </tr>
            <tr>
              <td><strong>Client charged</strong></td>
              <td>Exactly the price</td>
              <td>Anywhere from <code>minPrice</code> to <code>price</code></td>
            </tr>
            <tr>
              <td><strong>Use case</strong></td>
              <td>Static content, fixed-price APIs</td>
              <td>LLM inference, metered compute, variable workloads</td>
            </tr>
          </tbody>
        </table>

        <h2>Server-Side Code Example</h2>

        <pre><code>{`// 1. Set up payment args with "upto" scheme
const paymentArgs = {
  resourceUrl: "https://api.example.com/llm",
  method: "POST",
  paymentData,                    // the signed auth from the client's header
  payTo: "0xYourWallet...",       // where you get paid
  network: base,
  scheme: "upto",                 // enables variable pricing
  price: "$0.10",                 // max the client can be charged
  minPrice: "$0.01",              // min (protects against zero-cost abuse)
  facilitator: facilitatorUrl,
};

// 2. VERIFY first — don't do expensive work until you know they can pay
const verifyResult = await verifyPayment(paymentArgs);
if (verifyResult.status !== 200) {
  return Response.json(verifyResult.responseBody, {
    status: verifyResult.status,                  // 402
    headers: verifyResult.responseHeaders,
  });
}

// 3. NOW do the expensive work (LLM inference)
const { answer, tokensUsed } = await callLLM(userQuery);

// 4. SETTLE based on actual usage
const pricePerToken = 0.00001;  // $0.00001 per token
const settleResult = await settlePayment({
  ...paymentArgs,
  price: tokensUsed * pricePerToken,  // actual cost, NOT the max
});

// 5. Return the response
return Response.json({ answer });`}</code></pre>

        <h2>What the Facilitator Checks During Verify</h2>

        <p>Before you do any expensive work, <code>verifyPayment()</code> confirms three things:</p>

        <ol>
          <li><strong>Allowance</strong> — The ERC-3009 authorization is valid and covers at least <code>minPrice</code></li>
          <li><strong>Balance</strong> — The wallet actually has enough USDC</li>
          <li><strong>Expiration</strong> — The signed authorization hasn't timed out</li>
        </ol>

        <p>If any check fails → 402 back to the client, no work done, no compute wasted.</p>

        <h2>Why Verify Before Settling?</h2>

        <p>This is crucial for LLM APIs. Imagine if you skipped verification:</p>

        <ol>
          <li>Client sends a signed payment for a wallet with $0.00 USDC</li>
          <li>Server runs an expensive LLM query (costs you GPU time / money)</li>
          <li>Settlement fails — wallet is empty</li>
          <li>You did the work for free</li>
        </ol>

        <p>
          The verify step protects you: <strong>don't burn compute until you know you'll get paid</strong>.
        </p>

        <h2>Reusable Authorizations</h2>

        <p>
          A neat detail: the same signed authorization can be <strong>settled multiple times</strong> up to the max amount. 
          So a client could sign one $1.00 authorization and make multiple requests against it until the $1.00 is used up — like a session balance.
        </p>

        <p>
          This avoids re-signing for every single request, which is great for chatbot-style interactions where a user sends many messages.
        </p>

        <h2>Price Boundaries: price and minPrice</h2>

        <ul>
          <li><strong><code>price</code></strong> (max) — The ceiling. Client authorizes up to this amount. Protects the client from being overcharged.</li>
          <li><strong><code>minPrice</code></strong> (min) — The floor. Server won't do work for less than this. Protects the server from abuse (e.g., someone sending queries that cost you compute but settle for $0.000001).</li>
        </ul>

        <p>Example for an LLM API:</p>

        <pre><code>{`price: "$0.50"       // client won't pay more than 50 cents per request
minPrice: "$0.001"   // server won't run inference for less than 0.1 cents`}</code></pre>

        <p>The actual settlement amount lands somewhere between these two values based on token usage.</p>

        <h2>For Sangria</h2>

        <p>If we're building an LLM API with x402 payments, the flow would be:</p>

        <ol>
          <li>Our server advertises <code>scheme: "upto"</code>, <code>price: "$0.50"</code> (max per request)</li>
          <li>Client's wallet signs an authorization for up to $0.50 in USDC</li>
          <li>We verify they can pay → run the LLM → count tokens → settle for actual cost</li>
          <li>Client pays $0.003 for a short response, $0.15 for a long one — fair for everyone</li>
        </ol>

        <h2>Resources</h2>

        <ul>
          <li><a href="https://blog.thirdweb.com/changelog/dynamic-pricing-for-x402-resources/">thirdweb - Dynamic Pricing for x402</a></li>
          <li><a href="https://portal.thirdweb.com/x402/server">thirdweb - x402 Server Documentation</a></li>
          <li><a href="https://www.x402.org/writing/x402-v2-launch">x402.org - V2 Launch</a></li>
          <li><a href="https://github.com/coinbase/x402">x402 GitHub Repository</a></li>
        </ul>
      </article>
    </>
  );
}
