import { withAuth, getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Key, CreditCard, BarChart3, Settings } from "lucide-react";

export default async function DashboardPage() {
  const { user } = await withAuth();

  if (!user) {
    const signInUrl = await getSignInUrl();
    redirect(signInUrl);
  }

  const dashboardCards = [
    {
      title: "API Keys",
      description: "Manage your API keys for authenticating with Sangria services",
      icon: Key,
      href: "/dashboard/api-keys",
      color: "bg-blue-500",
    },
    {
      title: "Transactions",
      description: "View and manage your payment transactions",
      icon: CreditCard,
      href: "/dashboard/transactions",
      color: "bg-green-500",
      disabled: true,
    },
    {
      title: "Analytics",
      description: "View detailed analytics and usage metrics",
      icon: BarChart3,
      href: "/dashboard/analytics",
      color: "bg-purple-500",
      disabled: true,
    },
    {
      title: "Settings",
      description: "Configure your account and preferences",
      icon: Settings,
      href: "/dashboard/settings",
      color: "bg-gray-500",
      disabled: true,
    },
  ];

  return (
    <main className="min-h-screen pt-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Dashboard
          </h1>
          <p className="mt-2 text-gray-600 dark:text-zinc-400">
            Welcome back, {user.firstName ?? user.email}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {dashboardCards.map((card) => {
            const CardIcon = card.icon;
            const CardComponent = card.disabled ? "div" : Link;

            return (
              <CardComponent
                key={card.title}
                href={card.disabled ? undefined : card.href}
                className={`group relative p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-zinc-800 rounded-lg ${
                  card.disabled
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:border-gray-300 dark:hover:border-zinc-700 transition-colors cursor-pointer"
                }`}
              >
                {card.disabled && (
                  <div className="absolute inset-0 bg-gray-100 dark:bg-gray-900 opacity-50 rounded-lg"></div>
                )}
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-lg ${card.color} text-white`}>
                    <CardIcon className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-sangria-600 dark:group-hover:text-sangria-400 transition-colors">
                      {card.title}
                      {card.disabled && (
                        <span className="ml-2 text-xs text-gray-500 dark:text-zinc-400 font-normal">
                          (Coming Soon)
                        </span>
                      )}
                    </h3>
                    <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
                      {card.description}
                    </p>
                  </div>
                </div>
              </CardComponent>
            );
          })}
        </div>

        <div className="mt-12 p-6 bg-gradient-to-br from-sangria-50 to-sangria-100 dark:from-sangria-900/20 dark:to-sangria-800/20 border border-sangria-200 dark:border-sangria-800/50 rounded-lg">
          <h2 className="text-xl font-bold text-sangria-900 dark:text-sangria-100 mb-2">
            Get Started with Sangria
          </h2>
          <p className="text-sangria-700 dark:text-sangria-300 mb-4">
            Ready to integrate payments into your application? Start by creating your first API key and exploring our documentation.
          </p>
          <div className="flex gap-3">
            <Link
              href="/dashboard/api-keys"
              className="px-4 py-2 bg-sangria-600 text-white rounded-lg hover:bg-sangria-700 transition-colors"
            >
              Create API Key
            </Link>
            <Link
              href="/docs"
              className="px-4 py-2 border border-sangria-300 dark:border-sangria-700 text-sangria-700 dark:text-sangria-300 rounded-lg hover:bg-sangria-100 dark:hover:bg-sangria-900/30 transition-colors"
            >
              View Documentation
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
