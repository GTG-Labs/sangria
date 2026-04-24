import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Single audit surface for every process.env read in this app.
// Validation runs at build time — a missing or malformed var fails the build
// rather than silently falling back (e.g. to http://localhost:8080) in prod.
// Add new vars here; do not scatter process.env.X reads across the codebase.
export const env = createEnv({
  server: {
    BACKEND_URL: z.string().url(),
    BASE_URL: z.string().url(),
  },
  client: {
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: z.string().url(),
  },
  // Next.js build-time inlines the literal process.env.NEXT_PUBLIC_X, so
  // each NEXT_PUBLIC_* entry must appear verbatim here or the bundle ships
  // without it. Server vars must also be listed so the runtime has access.
  runtimeEnv: {
    BACKEND_URL: process.env.BACKEND_URL,
    BASE_URL: process.env.BASE_URL,
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  },
});
