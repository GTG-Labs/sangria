"use client";

import { useState, useCallback, useEffect, useRef } from "react";

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 240;
const STORAGE_KEY = "sidebar-width";

export default function ResizableSidebar({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const parsed = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH
      ? parsed
      : DEFAULT_WIDTH;
  });
  const widthRef = useRef(width);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      widthRef.current = clamped;
      setWidth(clamped);
    };

    const cleanup = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", cleanup);
      localStorage.setItem(STORAGE_KEY, String(widthRef.current));
      cleanupRef.current = null;
    };

    cleanupRef.current = cleanup;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", cleanup);
  }, []);

  return (
    <aside
      className="relative border-b border-zinc-200 bg-[#FAFAF8] lg:min-h-screen lg:border-b-0 lg:border-r"
      style={{ width }}
    >
      <div className="flex h-full flex-col px-3 pt-3 pb-0">
        {children}
      </div>

      <div
        onMouseDown={handleMouseDown}
        className="hidden lg:block absolute top-0 right-0 w-1 h-full cursor-col-resize group z-10"
      >
        <div className="absolute inset-y-0 right-0 w-[2px] transition-colors group-hover:bg-zinc-400" />
      </div>
    </aside>
  );
}
