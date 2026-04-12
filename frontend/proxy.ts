import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

export default authkitMiddleware({
  redirectUri: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
