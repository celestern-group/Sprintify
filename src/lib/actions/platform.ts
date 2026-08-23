"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import {
  getPlatformLockdown,
  getSignupDisabled,
  getWishlistEnabled,
  PLATFORM_SETTINGS_ID,
  type PlatformLockdown,
} from "@/lib/platform-lockdown";
import { requireAdminAction } from "@/lib/session";

export async function getPlatformLockdownState(): Promise<PlatformLockdown> {
  await requireAdminAction();
  return getPlatformLockdown();
}

const setPlatformLockdownSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(500).optional(),
});

export async function setPlatformLockdown(input: {
  enabled: boolean;
  message?: string;
}) {
  const parsed = setPlatformLockdownSchema.parse(input);
  const session = await requireAdminAction();

  const now = new Date();
  const values = {
    lockdownEnabled: parsed.enabled,
    lockdownMessage: parsed.enabled ? parsed.message?.trim() || null : null,
    lockdownAt: parsed.enabled ? now : null,
    lockdownByUserId: parsed.enabled ? session.user.id : null,
  };

  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, ...values })
    .onConflictDoUpdate({
      target: platformSettings.id,
      set: values,
    });

  await recordAudit({
    action: parsed.enabled
      ? "platform.lockdown_enabled"
      : "platform.lockdown_lifted",
    actor: { id: session.user.id, email: session.user.email },
    targetType: "platform",
    targetId: PLATFORM_SETTINGS_ID,
    metadata: parsed.enabled ? { message: values.lockdownMessage } : null,
  });

  revalidatePath("/admin", "layout");
  revalidatePath("/admin/platform", "page");
  revalidatePath("/sign-up", "page");
}

export async function getSignupDisabledState(): Promise<boolean> {
  await requireAdminAction();
  return getSignupDisabled();
}

const setSignupDisabledSchema = z.object({ disabled: z.boolean() });

export async function setSignupDisabled(input: { disabled: boolean }) {
  const parsed = setSignupDisabledSchema.parse(input);
  const session = await requireAdminAction();

  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, signupDisabled: parsed.disabled })
    .onConflictDoUpdate({
      target: platformSettings.id,
      set: { signupDisabled: parsed.disabled },
    });

  await recordAudit({
    action: parsed.disabled
      ? "platform.signup_disabled"
      : "platform.signup_enabled",
    actor: { id: session.user.id, email: session.user.email },
    targetType: "platform",
    targetId: PLATFORM_SETTINGS_ID,
  });

  revalidatePath("/admin/platform", "page");
  revalidatePath("/sign-up", "page");
  revalidatePath("/sign-in", "page");
}

export async function getWishlistEnabledState(): Promise<boolean> {
  await requireAdminAction();
  return getWishlistEnabled();
}

const setWishlistEnabledSchema = z.object({ enabled: z.boolean() });

export async function setWishlistEnabled(input: { enabled: boolean }) {
  const parsed = setWishlistEnabledSchema.parse(input);
  const session = await requireAdminAction();

  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, wishlistEnabled: parsed.enabled })
    .onConflictDoUpdate({
      target: platformSettings.id,
      set: { wishlistEnabled: parsed.enabled },
    });

  await recordAudit({
    action: parsed.enabled
      ? "platform.wishlist_enabled"
      : "platform.wishlist_disabled",
    actor: { id: session.user.id, email: session.user.email },
    targetType: "platform",
    targetId: PLATFORM_SETTINGS_ID,
  });

  revalidatePath("/admin/platform", "page");
  revalidatePath("/sign-up", "page");
  revalidatePath("/sign-in", "page");
}
