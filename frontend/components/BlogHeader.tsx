"use client";

import dynamic from "next/dynamic";

const Ballpit = dynamic(() => import("@/components/Ballpit"), { ssr: false });

export default function BlogHeader() {
  return (
    <div className="relative overflow-hidden h-[220px] flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="absolute inset-0">
        <Ballpit
          count={33}
          colors={[0xc74b4b, 0xa51c30, 0x8c1728]}
          lightIntensity={0}
          ambientIntensity={0.6}
          materialParams={{
            metalness: 0.1,
            roughness: 0.2,
            clearcoat: 1,
            clearcoatRoughness: 0.05,
          }}
          minSize={0.3}
          maxSize={0.8}
          gravity={0}
          friction={0.9999}
          wallBounce={0.99}
          maxVelocity={0.06}
          flowSpeed={0.0003}
          ballRepelRadius={1.5}
          ballRepelStrength={0.0005}
          followCursor={false}
        />
      </div>
      <h1 className="relative z-10 text-5xl md:text-7xl font-bold italic font-serif text-white mix-blend-difference select-none">
        Blog
      </h1>
    </div>
  );
}
