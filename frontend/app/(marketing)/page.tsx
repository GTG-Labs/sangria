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

    </div>
  );
}
