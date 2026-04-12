"use server";

import { signOut, getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

export async function handleSignOut() {
  await signOut();
}

export async function handleSignIn() {
  const url = await getSignInUrl();
  redirect(url);
}
