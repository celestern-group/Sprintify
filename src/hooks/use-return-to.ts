"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { RETURN_TO_PARAM } from "@/lib/return-to";

/**
 * The screen the reader is on right now, as the value to hand to
 * `withReturnTo` on every link that leaves it.
 *
 * It keeps the query string, because on the backlog that IS the screen —
 * `?view=board` is the difference between coming back to the board and coming
 * back to a list you weren't reading. It drops any inbound `from`, so opening
 * an item off an item off an item leaves one origin in the URL rather than a
 * chain of nested ones.
 *
 * The hash is deliberately not captured: it is only readable from
 * `window.location`, which would make this value differ between the server and
 * the first client render of the very links it composes.
 */
export function useReturnToHref(): string {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const params = new URLSearchParams(searchParams.toString());
  params.delete(RETURN_TO_PARAM);
  const query = params.toString();

  return query ? `${pathname}?${query}` : pathname;
}
