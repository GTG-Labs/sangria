import { authkitMiddleware } from '@workos-inc/authkit-nextjs';

export default authkitMiddleware({
  redirectUri: 'http://localhost:3000/auth/callback',
});

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };