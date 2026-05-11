import { handleSignIn } from "@/lib/auth-actions";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  // Await searchParams in Next.js 16+
  const params = await searchParams;

  // Immediately trigger WorkOS sign-in flow - this will redirect
  await handleSignIn();

  // This should never render since handleSignIn redirects
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="text-center">
            <h2 className="text-xl font-bold text-gray-900">
              Redirecting to Sign In...
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {params.reason === 'session_expired'
                ? 'Your session has expired for security reasons.'
                : 'Please sign in to continue.'
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}