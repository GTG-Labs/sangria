import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="border-t border-white/5 py-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sangria-500 to-indigo-500 flex items-center justify-center">
              <span className="text-white font-bold text-xs">S</span>
            </div>
            <span className="text-zinc-400 font-medium">Sangria</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-zinc-500">
            <Link href="/docs" className="hover:text-zinc-300 transition-colors">Documentation</Link>
            <Link href="https://www.x402.org/" className="hover:text-zinc-300 transition-colors">x402.org</Link>
            <Link href="https://github.com/GTG-Labs/sangria-net" className="hover:text-zinc-300 transition-colors">GitHub</Link>
          </div>
          <p className="text-xs text-zinc-600">&copy; 2026 Sangria. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
