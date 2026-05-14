import ArcadeButton from "@/components/ArcadeButton";
import SignInForm from "@/components/SignInForm";
import { getCachedAuth } from "@/lib/auth";

export default async function Home() {
  const { user } = await getCachedAuth();

  return (
    <div className="h-screen overflow-hidden">
      {/* Hero */}
      <section className="relative h-full flex items-center overflow-hidden">
        <div className="relative max-w-7xl mx-auto px-6">
          <div>
            <div className="text-left fade-in relative z-10">
              <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold text-gray-900 dark:text-white leading-[1.1] tracking-tight mb-10 whitespace-nowrap">
                Bank accounts <span className="text-sangria-500">for your agent.</span>
              </h1>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-4">
                {user ? (
                  <ArcadeButton
                    href="/dashboard/api-keys"
                    glow
                    className="[&>span]:w-full sm:[&>span]:w-auto"
                  >
                    Go to Dashboard →
                  </ArcadeButton>
                ) : (
                  <SignInForm className="btn-raised glow w-full sm:w-auto [&>span]:w-full sm:[&>span]:w-auto">
                    <span className="px-10 py-3 text-sm leading-none">
                      Sign Up →
                    </span>
                  </SignInForm>
                )}
                <ArcadeButton
                  href="https://github.com/GTG-Labs/sangria"
                  variant="secondary"
                  className="[&>span]:w-full sm:[&>span]:w-auto"
                >
                  View on GitHub →
                </ArcadeButton>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
