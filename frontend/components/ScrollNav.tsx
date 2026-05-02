"use client";

import { useEffect, useState } from "react";

export default function ScrollNav({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 w-full z-50 transition-all duration-300 border-b border-zinc-200 dark:border-zinc-800 ${
        scrolled ? "bg-white/30 dark:bg-zinc-950/30 backdrop-blur-2xl" : "bg-transparent"
      }`}
    >
      {children}
    </nav>
  );
}
