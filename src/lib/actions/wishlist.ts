"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { user, wishlistRequest } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import {
  assertPlatformNotLocked,
  getSignupDisabled,
  getWishlistEnabled,
} from "@/lib/platform-lockdown";
import { requireAdminAction } from "@/lib/session";
import { verifyTurnstile } from "@/lib/turnstile";

const wishlistRequestSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().email("Enter a valid email address.").max(320),
  captchaToken: z
    .string()
    .min(1, "Complete the captcha before requesting access."),
});

const wishlistRequestIdSchema = z.object({ id: z.string().uuid() });
const wishlistRequestIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
});

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function submitWishlistRequest(input: {
  name: string;
  email: string;
  captchaToken: string;
}) {
  const parsed = wishlistRequestSchema.parse(input);

  if (!(await getSignupDisabled())) {
    throw new Error(
      "Public sign-up is available. Create your account instead.",
    );
  }
  if (!(await getWishlistEnabled())) {
    throw new Error("Access requests are not currently available.");
  }
  await assertPlatformNotLocked();
  await verifyTurnstile(parsed.captchaToken);

  const email = normalizeEmail(parsed.email);
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (existingUser) {
    throw new Error(
      "An account already exists for this email address. Please sign in.",
    );
  }

  try {
    const [request] = await db
      .insert(wishlistRequest)
      .values({ id: crypto.randomUUID(), name: parsed.name, email })
      .returning({ id: wishlistRequest.id });

    await recordAudit({
      action: "wishlist.requested",
      targetType: "wishlist_request",
      targetId: request.id,
      metadata: { email, name: parsed.name },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new Error(
        "A request for this email address is already waiting for review.",
      );
    }
    throw error;
  }
}

export type WishlistRequest = {
  id: string;
  name: string;
  email: string;
  requestedAt: Date;
};

export async function getPendingWishlistRequests(): Promise<WishlistRequest[]> {
  await requireAdminAction();
  return db
    .select({
      id: wishlistRequest.id,
      name: wishlistRequest.name,
      email: wishlistRequest.email,
      requestedAt: wishlistRequest.requestedAt,
    })
    .from(wishlistRequest)
    .where(eq(wishlistRequest.status, "pending"))
    .orderBy(desc(wishlistRequest.requestedAt));
}

export async function approveWishlistRequest(input: { id: string }) {
  const parsed = wishlistRequestIdSchema.parse(input);
  const session = await requireAdminAction();
  await assertPlatformNotLocked();

  const { request, targetUserId, accountCreated } = await db.transaction(
    async (tx) => {
      // Lock the pending row before provisioning. A second approver waits for
      // this transaction, then sees the completed status instead of racing to
      // create the same account and skipping its activation email.
      const [request] = await tx
        .select()
        .from(wishlistRequest)
        .where(
          and(
            eq(wishlistRequest.id, parsed.id),
            eq(wishlistRequest.status, "pending"),
          ),
        )
        .for("update")
        .limit(1);
      if (!request) {
        throw new Error("This request is no longer awaiting approval.");
      }

      let targetUserId: string;
      let accountCreated = false;
      try {
        const created = await auth.api.createUser({
          body: {
            email: request.email,
            name: request.name,
            data: { emailVerified: true },
          },
        });
        targetUserId = created.user.id;
        accountCreated = true;
      } catch (error) {
        const code = (error as { body?: { code?: string } })?.body?.code;
        if (code !== "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") throw error;
        const [existingUser] = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.email, request.email))
          .limit(1);
        if (!existingUser) throw error;
        targetUserId = existingUser.id;
      }

      await tx
        .update(wishlistRequest)
        .set({
          status: "approved",
          approvedAt: new Date(),
          approvedByUserId: session.user.id,
          provisionedUserId: targetUserId,
        })
        .where(eq(wishlistRequest.id, request.id));

      return { request, targetUserId, accountCreated };
    },
  );

  // The password-reset endpoint uses the account's absent credential as the
  // signal to send its "set your password" copy. Existing accounts do not get
  // a surprise reset email; they can sign in normally.
  if (accountCreated) {
    await auth.api.requestPasswordReset({
      body: {
        email: request.email,
        redirectTo: "/reset-password?activate=1&next=%2Fapp",
      },
    });
  }

  await recordAudit({
    action: "wishlist.approved",
    actor: { id: session.user.id, email: session.user.email },
    targetType: "wishlist_request",
    targetId: request.id,
    metadata: { email: request.email, userId: targetUserId, accountCreated },
  });
  if (accountCreated) {
    await recordAudit({
      action: "user.provisioned",
      actor: { id: session.user.id, email: session.user.email },
      targetType: "user",
      targetId: targetUserId,
      metadata: { email: request.email, via: "wishlist_approval" },
    });
  }

  revalidatePath("/admin/wishlist", "page");
  revalidatePath("/sign-up", "page");
  return { accountCreated };
}

/** Rejects one or more still-pending requests without provisioning accounts. */
export async function rejectWishlistRequests(input: { ids: string[] }) {
  const parsed = wishlistRequestIdsSchema.parse(input);
  const session = await requireAdminAction();

  const rejected = await db
    .update(wishlistRequest)
    .set({ status: "rejected" })
    .where(
      and(
        inArray(wishlistRequest.id, [...new Set(parsed.ids)]),
        eq(wishlistRequest.status, "pending"),
      ),
    )
    .returning({ id: wishlistRequest.id, email: wishlistRequest.email });

  await Promise.all(
    rejected.map((request) =>
      recordAudit({
        action: "wishlist.rejected",
        actor: { id: session.user.id, email: session.user.email },
        targetType: "wishlist_request",
        targetId: request.id,
        metadata: { email: request.email },
      }),
    ),
  );

  revalidatePath("/admin/wishlist", "page");
  return { rejected: rejected.length };
}
