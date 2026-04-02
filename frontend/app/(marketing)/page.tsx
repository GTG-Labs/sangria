import Image from "next/image";
import ArcadeButton from "@/components/ArcadeButton";

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-32 overflow-hidden">
        <div className="relative max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Left: text */}
            <div className="text-left fade-in relative z-10">
              <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold text-gray-900 dark:text-white leading-[1.1] tracking-tight mb-6">
                Let agents pay
                <br />
                <span className="text-sangria-500">for your API.</span>
              </h1>

              <p className="text-base md:text-lg text-zinc-600 dark:text-zinc-400 max-w-md mb-10 leading-relaxed">
                sangriaNet is a drop-in SDK that integrates with your backend
                and allows you to monetize your endpoints so agents can
                call and pay for them.
              </p>

              <div className="flex flex-col sm:flex-row items-start gap-4">
                <ArcadeButton href="/docs" glow>
                  Get Started →
                </ArcadeButton>
                <ArcadeButton
                  href="https://github.com/GTG-Labs/sangria-net"
                  variant="secondary"
                >
                  View on GitHub →
                </ArcadeButton>
              </div>
            </div>

            {/* Right: illustration */}
            <div className="hidden md:flex items-center justify-center">
              <Image
                src="/computey2.png"
                alt="Pixel art computer holding a sangria"
                width={500}
                height={500}
                className="w-full max-w-md"
                priority
              />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        className="py-20 md:py-32 border-t border-zinc-100 dark:border-white/5"
      >
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sangria-500 font-mono text-sm mb-3">FEATURES</p>
            <h2 className="text-3xl md:text-4xl italic font-normal text-gray-900 dark:text-white">
              Why x402?
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="card p-6 card-hover">
              <div className="w-10 h-10 rounded-xl bg-sangria-500/10 flex items-center justify-center mb-4">
                <Zap className="w-5 h-5 text-sangria-500" />
              </div>
              <h3 className="text-gray-900 dark:text-white italic mb-2">
                True Micropayments
              </h3>
              <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
                Pay-per-request pricing as low as $0.0001. Perfect for AI
                agents, APIs, and metered content.
              </p>
            </div>

            <div className="card p-6 card-hover">
              <div className="w-10 h-10 rounded-xl bg-sangria-500/10 flex items-center justify-center mb-4">
                <Lock className="w-5 h-5 text-sangria-500" />
              </div>
              <h3 className="text-gray-900 dark:text-white italic mb-2">
                No Accounts Required
              </h3>
              <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
                No signup, no API keys, no subscription. Just HTTP + crypto
                wallet = instant access.
              </p>
            </div>

            <div className="card p-6 card-hover">
              <div className="w-10 h-10 rounded-xl bg-sangria-500/10 flex items-center justify-center mb-4">
                <Globe className="w-5 h-5 text-sangria-500" />
              </div>
              <h3 className="text-gray-900 dark:text-white italic mb-2">
                Standard HTTP
              </h3>
              <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
                Uses the HTTP 402 status code from the original spec. No custom
                protocols or backends required.
              </p>
            </div>

            <div className="card p-6 card-hover">
              <div className="w-10 h-10 rounded-xl bg-sangria-500/10 flex items-center justify-center mb-4">
                <Code2 className="w-5 h-5 text-sangria-500" />
              </div>
              <h3 className="text-gray-900 dark:text-white italic mb-2">
                Developer Friendly
              </h3>
              <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
                Middleware-based API for servers. Client library handles
                402 negotiation transparently.
              </p>
            </div>

            <div className="card p-6 card-hover">
              <div className="w-10 h-10 rounded-xl bg-sangria-500/10 flex items-center justify-center mb-4">
                <Coins className="w-5 h-5 text-sangria-500" />
              </div>
              <h3 className="text-gray-900 dark:text-white italic mb-2">
                Blockchain Settled
              </h3>
              <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
                Every payment is settled on-chain via USDC. Transparent,
                verifiable, and censorship-resistant.
              </p>
            </div>

            <div className="card p-6 card-hover">
              <div className="w-10 h-10 rounded-xl bg-sangria-500/10 flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5 text-sangria-500" />
              </div>
              <h3 className="text-gray-900 dark:text-white italic mb-2">
                Testnet Ready
              </h3>
              <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
                Demo runs on Base Sepolia. Free testnet USDC via Coinbase
                Developer Platform faucets.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Code Example */}
      <section
        id="developers"
        className="py-20 md:py-32 border-t border-zinc-100 dark:border-white/5"
      >
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-sangria-500 font-mono text-sm mb-3">
                FOR DEVELOPERS
              </p>
              <h2 className="text-3xl md:text-4xl italic font-normal text-gray-900 dark:text-white mb-6">
                Add a paid endpoint in minutes
              </h2>
              <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed mb-8">
                Create an{" "}
                <code className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-white/5 text-sangria-500 font-mono text-sm">
                  HTTPFacilitatorClient
                </code>{" "}
                and{" "}
                <code className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-white/5 text-sangria-500 font-mono text-sm">
                  x402ResourceServer
                </code>
                , define a{" "}
                <code className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-white/5 text-sangria-500 font-mono text-sm">
                  routes
                </code>{" "}
                mapping, then attach{" "}
                <code className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-white/5 text-sangria-500 font-mono text-sm">
                  PaymentMiddlewareASGI
                </code>{" "}
                via{" "}
                <code className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-white/5 text-sangria-500 font-mono text-sm">
                  app.add_middleware
                </code>
                . Payment verification and settlement are handled automatically.
              </p>
              <div className="flex flex-wrap gap-3">
                <span className="px-3 py-1 rounded-full bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-xs text-zinc-600 dark:text-zinc-400 font-mono">
                  Python
                </span>
                <span className="px-3 py-1 rounded-full bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-xs text-zinc-600 dark:text-zinc-400 font-mono">
                  FastAPI
                </span>
                <span className="px-3 py-1 rounded-full bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-xs text-zinc-600 dark:text-zinc-400 font-mono">
                  USDC
                </span>
                <span className="px-3 py-1 rounded-full bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-xs text-zinc-600 dark:text-zinc-400 font-mono">
                  Base
                </span>
              </div>
            </div>

            <div className="code-block rounded-2xl border border-zinc-200 dark:border-white/5 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-zinc-200 dark:border-white/5">
                <span className="w-3 h-3 rounded-full bg-red-500/60"></span>
                <span className="w-3 h-3 rounded-full bg-yellow-500/60"></span>
                <span className="w-3 h-3 rounded-full bg-green-500/60"></span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono ml-2">
                  merchant_server/app.py
                </span>
              </div>
              <pre className="p-5 text-sm font-mono leading-relaxed overflow-x-auto">
                <code>{`from fastapi import FastAPI
from x402.http import FacilitatorConfig, HTTPFacilitatorClient, PaymentOption
from x402.http.middleware.fastapi import PaymentMiddlewareASGI
from x402.http.types import RouteConfig
from x402.mechanisms.evm.exact import ExactEvmServerScheme
from x402.server import x402ResourceServer

app = FastAPI()
facilitator = HTTPFacilitatorClient(
    FacilitatorConfig(url="https://x402.org/facilitator"))
server = x402ResourceServer(facilitator)
server.register("eip155:84532", ExactEvmServerScheme())

routes = {"GET /premium": RouteConfig(
    accepts=[PaymentOption(scheme="exact",
        pay_to="0xF44c...fd39", price="$0.0001",
        network="eip155:84532")],
    mime_type="application/json")}
app.add_middleware(
    PaymentMiddlewareASGI, routes=routes, server=server)

@app.get("/premium")
async def premium_endpoint():
    return {
        "message": "You accessed the premium endpoint!",
        "paid": True
    }`}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Project Info */}
      <section className="py-16 border-t border-zinc-100 dark:border-white/5">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-3xl italic text-gray-900 dark:text-white mb-1">
                $0.0001
              </div>
              <div className="text-sm text-zinc-500">Minimum Payment</div>
            </div>
            <div>
              <div className="text-3xl italic text-gray-900 dark:text-white mb-1">
                402
              </div>
              <div className="text-sm text-zinc-500">HTTP Status Code</div>
            </div>
            <div>
              <div className="text-3xl italic text-gray-900 dark:text-white mb-1">
                &lt;3s
              </div>
              <div className="text-sm text-zinc-500">Settlement Time</div>
            </div>
            <div>
              <div className="text-3xl italic text-gray-900 dark:text-white mb-1">
                100%
              </div>
              <div className="text-sm text-zinc-500">Open Source</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        id="get-started"
        className="py-20 md:py-32 border-t border-zinc-100 dark:border-white/5"
      >
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl italic font-normal text-gray-900 dark:text-white mb-4">
            Ready to try it?
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400 mb-10 text-lg">
            Clone the repo, run the demo, and see HTTP micropayments in action.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 max-w-xl mx-auto justify-center">
            <Link
              href="https://github.com/GTG-Labs/sangria-net"
              className="px-6 py-3 rounded-xl bg-sangria-500 text-white font-semibold text-sm hover:bg-sangria-600 transition-colors"
            >
              View on GitHub
            </Link>
            <Link
              href="/docs"
              className="px-6 py-3 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 font-medium text-sm hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
            >
              Read Documentation
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
