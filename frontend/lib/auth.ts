import { cache } from "react";
import { withAuth } from "@workos-inc/authkit-nextjs";

/**
 * Cached auth helper for server components.
 *
 * Multiple server components in the same render pass (e.g. Navigation + page)
 * may both need the current user. Without caching, each call executes
 * independently because withAuth() is an SDK function, not a native fetch()
 * call — so Next.js request memoization doesn't apply.
 *
 * React.cache() ensures withAuth() runs exactly once per request.
 */
export const getCachedAuth = cache(() => withAuth());
