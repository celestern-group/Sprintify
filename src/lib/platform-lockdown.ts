import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";

export const PLATFORM_SETTINGS_ID = "platform";

export const DEFAULT_LOCKDOWN_MESSAGE =
  "New sign-ups and workspace creation are temporarily paused by the platform administrators. Please try again later.";

export type PlatformLockdown = {
  enabled: boolean;
  message: string;
  enabledAt: Date | null;
  enabledByUserId: string | null;
};

// Deliberately NOT wrapped in React cache(): this backs the emergency
// lockdown, so every gated call must see the current value — a stale
// "unlocked" read here is exactly the failure the red button exists to stop.
export async function getPlatformLockdown(): Promise<PlatformLockdown> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);

  return {
    enabled: row?.lockdownEnabled ?? false,
    message: row?.lockdownMessage?.trim() || DEFAULT_LOCKDOWN_MESSAGE,
    enabledAt: row?.lockdownAt ?? null,
    enabledByUserId: row?.lockdownByUserId ?? null,
  };
}

/** Throws (with the admin-set message) when the platform lockdown is active. */
export async function assertPlatformNotLocked(): Promise<void> {
  const lockdown = await getPlatformLockdown();
  if (lockdown.enabled) {
    throw new Error(lockdown.message);
  }
}

// Runtime "invite only" switch (admin-toggled at /admin/platform). Replaces the
// old build-time NEXT_PUBLIC_ALLOW_SIGNUP env flag. Deliberately un-cached, like
// getPlatformLockdown() — the gated sign-up paths must see the current value.
export async function getSignupDisabled(): Promise<boolean> {
  const [row] = await db
    .select({ signupDisabled: platformSettings.signupDisabled })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);

  return row?.signupDisabled ?? false;
}

/** Whether invite-only visitors may submit a platform access request. */
export async function getWishlistEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ wishlistEnabled: platformSettings.wishlistEnabled })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);

  return row?.wishlistEnabled ?? false;
}
