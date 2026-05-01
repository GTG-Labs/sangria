"use client";

import { handleSignOut } from "@/lib/auth-actions";
import { useState } from "react";
import ArcadeButton from "@/components/ArcadeButton";

interface SignOutButtonProps {
  children?: React.ReactNode;
}

export function SignOutButton({ children }: SignOutButtonProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSubmit = async () => {
    setIsSigningOut(true);
    await handleSignOut();
  };

  return (
    <form action={handleSubmit} className="w-full">
      <ArcadeButton type="submit" disabled={isSigningOut} variant="secondary" size="sm" className="w-full">
        {isSigningOut ? "Signing out..." : children || "Sign Out"}
      </ArcadeButton>
    </form>
  );
}
