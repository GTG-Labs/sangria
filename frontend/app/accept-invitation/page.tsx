"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, XCircle, Loader, LogIn } from "lucide-react";
import { handleSignIn } from "@/lib/auth-actions";

export default function AcceptInvitationPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  const acceptInvitation = async () => {
    if (!token) {
      setStatus("error");
      setMessage("Invalid invitation link. No token found.");
      return;
    }

    setStatus("loading");
    setMessage("");

    try {
      const response = await fetch("/api/backend/accept-invitation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();

      if (response.ok) {
        setOrganizationId(data.organization_id);

        // Check if user is already logged in — if so, redirect to dashboard
        try {
          const meResponse = await fetch("/api/backend/me");
          if (meResponse.ok) {
            router.push("/dashboard");
            return;
          }
        } catch {
          // Not logged in — fall through to show sign-in button
        }

        setStatus("success");
        setMessage(data.message || "Invitation accepted successfully!");
      } else {
        setStatus("error");
        setMessage(data.error || "Failed to accept invitation.");
      }
    } catch (error) {
      console.error("Failed to accept invitation:", error);
      setStatus("error");
      setMessage("An unexpected error occurred. Please try again.");
    }
  };

  useEffect(() => {
    acceptInvitation();
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="text-center">
            {status === "loading" && (
              <>
                <Loader className="mx-auto h-12 w-12 text-blue-500 animate-spin" />
                <h2 className="mt-4 text-xl font-bold text-gray-900">
                  Processing Invitation
                </h2>
                <p className="mt-2 text-sm text-gray-600">
                  Accepting your invitation. Please sign in to complete account creation and join the organization.
                </p>
              </>
            )}

            {status === "success" && (
              <>
                <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
                <h2 className="mt-4 text-xl font-bold text-green-900">
                  Welcome to the Team! 🎉
                </h2>
                <p className="mt-2 text-sm text-gray-600">{message}</p>
                <p className="mt-4 text-sm text-gray-500">
                  Now you need to sign in to access your account and the organization.
                </p>
                <div className="mt-6 space-y-3">
                  <button
                    onClick={() => handleSignIn()}
                    className="w-full inline-flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    <LogIn className="w-4 h-4 mr-2" />
                    Sign In to Continue
                  </button>
                </div>
              </>
            )}

            {status === "error" && (
              <>
                <XCircle className="mx-auto h-12 w-12 text-red-500" />
                <h2 className="mt-4 text-xl font-bold text-red-900">
                  Invitation Error
                </h2>
                <p className="mt-2 text-sm text-gray-600">{message}</p>
                <div className="mt-6 space-y-3">
                  <button
                    onClick={() => acceptInvitation()}
                    className="w-full inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Try Again
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}