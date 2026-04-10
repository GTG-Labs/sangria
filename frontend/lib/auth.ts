import { cache } from "react";
import { withAuth, getSignInUrl } from "@workos-inc/authkit-nextjs";

/**
 * Cached auth helpers for server components.
 *
 * Multiple server components in the same render pass (e.g. Navigation + page)
 * may both need the current user and sign-in URL. Without caching, each call
 * executes independently because these are SDK functions, not native fetch()
 * calls — so Next.js request memoization doesn't apply.
 *
 * getSignInUrl() is particularly important to cache because it generates a
 * PKCE code verifier and writes it to a cookie. A second call would overwrite
 * the first, causing auth to fail when the verifier doesn't match the URL.
 *
 * React.cache() ensures each function runs exactly once per request.
 */
export const getCachedAuth = cache(() => withAuth());
export const getCachedSignInUrl = cache(() => getSignInUrl());
