"use client";

import dynamic from "next/dynamic";

const PixelBlast = dynamic(() => import("@/components/PixelBlast"), {
  ssr: false,
});

export default function HeroBackground() {
  return (
    <div className="absolute inset-0 pointer-events-auto">
      <PixelBlast
        variant="diamond"
        color="#a72525"
        patternScale={6.75}
        edgeFade={0.5}
        speed={0.5}
      />
    </div>
  );
}
