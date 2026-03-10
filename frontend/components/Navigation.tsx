import Link from 'next/link';

export default function Navigation() {
  return (
    <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-surface/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sangria-500 to-indigo-500 flex items-center justify-center">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <span className="text-white font-semibold text-lg">Sangria</span>
        </Link>
        <div className="hidden md:flex items-center gap-8 text-sm text-zinc-400">
          <Link href="/#how-it-works" className="hover:text-white transition-colors">How it Works</Link>
          <Link href="/#features" className="hover:text-white transition-colors">Features</Link>
          <Link href="/#developers" className="hover:text-white transition-colors">Developers</Link>
          <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
        </div>
        <div className="flex items-center gap-3">
          <Link 
            href="https://github.com/GTG-Labs/sangria-net" 
            className="text-sm font-medium px-4 py-2 rounded-lg bg-gradient-to-r from-sangria-600 to-indigo-600 text-white hover:opacity-90 transition-opacity"
          >
            View on GitHub
          </Link>
        </div>
      </div>
    </nav>
  );
}
