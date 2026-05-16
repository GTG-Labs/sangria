"use client";

import { useState, useEffect } from "react";
import Image from "next/image";

const IMAGES = ["/benf1.png", "/benf2.png", "/benf3.png", "/benf4.png"] as const;
const BASE_INTERVAL = 1500;
const JITTER = 400;

export default function BenCycler({ className = "" }: { className?: string }) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout>;

    function tick() {
      if (!active) return;
      const delay = BASE_INTERVAL + (Math.random() * 2 - 1) * JITTER;
      timeoutId = setTimeout(() => {
        setActiveIndex((prev) => (prev + 1) % IMAGES.length);
        tick();
      }, delay);
    }
    tick();

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, []);

  return (
    <div className={`relative ${className}`} aria-hidden="true">
      {IMAGES.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt=""
          width={1195}
          height={896}
          className={`w-full h-auto ${
            i === 0 ? "relative" : "absolute inset-0"
          } ${i === activeIndex ? "opacity-100" : "opacity-0"}`}
          priority={i === 0}
          draggable={false}
        />
      ))}
    </div>
  );
}
