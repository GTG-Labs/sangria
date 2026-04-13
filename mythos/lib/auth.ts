import { cache } from "react";
import { withAuth } from "@workos-inc/authkit-nextjs";

export const getCachedAuth = cache(() => withAuth());
