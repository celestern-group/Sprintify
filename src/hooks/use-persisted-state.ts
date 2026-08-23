"use client";

import { useEffect, useRef, useState } from "react";
import { usePreferenceScope } from "@/components/preferences/preference-scope";

/**
 * Bumped only when a stored SHAPE changes incompatibly and a reviver can no
 * longer read the old value. Individual keys don't need it — a reviver that
 * rejects an unexpected value already falls back to the default.
 */
const STORAGE_PREFIX = "sprintify:pref:v1";

/**
 * Turns whatever came out of storage into a usable value, or `null` to fall
 * back to the default. It is REQUIRED rather than optional because localStorage
 * is user-writable and long-lived: last release's shape, a half-written value,
 * or a hand-edited one all arrive here, and a component that trusted the raw
 * JSON would crash on render with no way for the user to recover short of
 * clearing site data.
 */
export type Reviver<T> = (raw: unknown) => T | null;

/**
 * `useState` whose value survives reloads, stored per viewer and per scope (see
 * `PreferenceScopeProvider`).
 *
 * It is deliberately CLIENT-side. A filter set changes on every checkbox tick;
 * a server round-trip per tick would put a network hop between the click and
 * the list, and an audit row behind each one. View state is a habit of the
 * browser you work in, not a record the org needs.
 *
 * State always starts at `fallback` and adopts the stored value in an effect —
 * reading storage during render would desync hydration, since the server
 * rendered the default.
 */
export function usePersistedState<T>(
  /** Key within the scope, e.g. `backlog.filters`. */
  name: string,
  fallback: T,
  revive: Reviver<T>,
): [T, (next: T | ((current: T) => T)) => void] {
  const scope = usePreferenceScope();
  const key = `${STORAGE_PREFIX}:${scope || "shared"}:${name}`;

  const [value, setValue] = useState<T>(fallback);
  /**
   * Which key the current `value` was restored for. State rather than a ref so
   * the write effect below can't fire in the same commit as the read: on a key
   * change (navigating to another project) the read effect updates both, and
   * the write effect still sees the OLD key here and skips — otherwise it would
   * write the outgoing project's filters over the incoming project's.
   */
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  // Held in refs so the read effect depends on the key alone: both are almost
  // always fresh identities (an inline object, an inline arrow), and depending
  // on them would re-read storage — and stomp the live value — every render.
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const reviveRef = useRef(revive);
  reviveRef.current = revive;

  useEffect(() => {
    let restored: T | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) restored = reviveRef.current(JSON.parse(raw));
    } catch {
      // Unreadable (disabled storage, quota, corrupt JSON) is the same answer
      // as unset: use the default.
      restored = null;
    }
    setValue(restored ?? fallbackRef.current);
    setHydratedFor(key);
  }, [key]);

  useEffect(() => {
    if (hydratedFor !== key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked — the preference is lost, the session isn't.
    }
  }, [hydratedFor, key, value]);

  return [value, setValue];
}

/** `usePersistedState` for a value from a closed set (a view, a range, a mode). */
export function usePersistedChoice<T extends string>(
  name: string,
  fallback: T,
  allowed: readonly T[],
): [T, (next: T | ((current: T) => T)) => void] {
  // The reviver is held in a ref by `usePersistedState`, so an inline arrow
  // closing over the current `allowed` is both correct and cheap.
  return usePersistedState<T>(name, fallback, (raw) =>
    typeof raw === "string" && (allowed as readonly string[]).includes(raw)
      ? (raw as T)
      : null,
  );
}

/** `usePersistedState` for an on/off toggle. */
export function usePersistedFlag(
  name: string,
  fallback: boolean,
): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  return usePersistedState<boolean>(name, fallback, reviveBoolean);
}

export function reviveBoolean(raw: unknown): boolean | null {
  return typeof raw === "boolean" ? raw : null;
}

/** Free text — a search box, a note. Capped so storage can't be used as a heap. */
export function reviveString(raw: unknown): string | null {
  return typeof raw === "string" ? raw.slice(0, 500) : null;
}

/**
 * A list of ids (a multi-select filter). Ids that no longer exist are left in —
 * a filter is a set of ids, and an item is matched or it isn't, so a stale id
 * simply never matches. Dropping it here would need the caller's current
 * options, which the reviver has no business knowing.
 */
export function reviveStringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((entry): entry is string => typeof entry === "string");
}

/** A `Record<string, number>` — dragged column widths and the like. */
export function reviveNumberRecord(
  raw: unknown,
): Record<string, number> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const result: Record<string, number> = {};
  for (const [entryKey, entryValue] of Object.entries(raw)) {
    if (typeof entryValue === "number" && Number.isFinite(entryValue)) {
      result[entryKey] = entryValue;
    }
  }
  return result;
}
