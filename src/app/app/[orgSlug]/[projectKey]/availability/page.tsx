import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireProjectWorkspace } from "@/lib/project-workspace";

/**
 * Availability moved up to /app/[orgSlug]/availability. This route stays as the
 * compatibility hop for links and bookmarks made while it was project-scoped:
 * resolving the workspace pins the project the URL names, so the org-level page
 * then renders as that project rather than whichever one was active before.
 */
export default async function LegacyProjectAvailabilityPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectKey: string }>;
}) {
  const { orgSlug, projectKey } = await params;

  // TEMPORARY (remove once the refetch loop is diagnosed). This route redirects,
  // so it is the one to watch for a redirect ping-pong: if it appears in the log
  // interleaved with [availability], the two pages are bouncing off each other.
  if (process.env.NODE_ENV === "development") {
    const h = await headers();
    console.log("[legacy availability]", {
      rsc: h.get("rsc"),
      prefetch: h.get("next-router-prefetch"),
      referer: h.get("referer"),
      secPurpose: h.get("sec-purpose"),
      mode: h.get("sec-fetch-mode"),
    });
  }

  await requireProjectWorkspace(orgSlug, projectKey);
  redirect(`/app/${orgSlug}/availability`);
}
