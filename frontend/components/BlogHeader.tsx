"use client";

import dynamic from "next/dynamic";

const Ballpit = dynamic(() => import("@/components/Ballpit"), { ssr: false });

export default function BlogHeader() {
  return (
    <div className="relative overflow-hidden h-[220px] flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="absolute inset-0">
        <Ballpit
          count={350}
          colors={[0xc74b4b, 0xa51c30, 0x8c1728]}
          lightIntensity={0}
          ambientIntensity={0.4}
          materialParams={{
            metalness: 0.2,
            roughness: 0.15,
            clearcoat: 1,
            clearcoatRoughness: 0.05,
          }}
          minSize={0.25}
          maxSize={0.5}
          gravity={0.5}
          friction={0.99}
          wallBounce={0.5}
          maxVelocity={0.08}
          centerRepelRadius={3.5}
          centerRepelStrength={0.003}
          followCursor={false}
        />
      </div>
      <h1 className="relative z-10 text-5xl md:text-7xl font-bold italic font-serif text-white mix-blend-difference select-none">
        Blog
      </h1>
    </div>
  );
}
