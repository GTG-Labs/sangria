'use client';

import { handleSignOut } from '@/lib/auth-actions';
import { useState } from 'react';

interface SignOutButtonProps {
  className?: string;
  children?: React.ReactNode;
}

export function SignOutButton({ className, children }: SignOutButtonProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSubmit = async () => {
    setIsSigningOut(true);
    // Add a small delay to make it feel more natural
    await new Promise(resolve => setTimeout(resolve, 800));
    await handleSignOut();
  };

  return (
    <form action={handleSubmit}>
      <button
        type="submit"
        disabled={isSigningOut}
        className={className}
      >
        {isSigningOut ? 'Signing out...' : (children || 'Sign Out')}
      </button>
    </form>
  );
}