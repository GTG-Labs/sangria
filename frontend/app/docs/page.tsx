import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';

export default function DocsPage() {
  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-5xl mx-auto px-6">
        <Link href="/" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <div className="mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Documentation</h1>
          <p className="text-lg text-zinc-400">Learn how to use the x402 protocol and run the Sangria demo.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Link href="/docs/getting-started" className="gradient-border p-6 card-hover block">
            <div className="w-10 h-10 rounded-xl bg-sangria-500/10 flex items-center justify-center mb-4">
              <BookOpen className="w-5 h-5 text-sangria-400" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-2">Getting Started</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Prerequisites, setup, and running your first x402 micropayment demo.
            </p>
          </Link>

          <Link href="/docs/x402-protocol" className="gradient-border p-6 card-hover block">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center mb-4">
              <BookOpen className="w-5 h-5 text-purple-400" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-2">x402 Protocol</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Deep dive into how the x402 protocol works under the hood.
            </p>
          </Link>

          <Link href="/docs/variable-pricing" className="gradient-border p-6 card-hover block">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center mb-4">
              <BookOpen className="w-5 h-5 text-indigo-400" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-2">Variable Pricing</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Advanced: implementing dynamic pricing and usage-based costs.
            </p>
          </Link>

          <Link href="/docs/architecture" className="gradient-border p-6 card-hover block">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-4">
              <BookOpen className="w-5 h-5 text-emerald-400" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-2">Project Architecture</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Understanding the code structure, wallet management, and components.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
