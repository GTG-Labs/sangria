import { handleSignIn } from "@/lib/auth-actions";

export default function SignInForm({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form action={handleSignIn}>
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}
