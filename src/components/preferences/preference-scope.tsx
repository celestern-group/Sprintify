"use client";

import { createContext, useContext, useMemo } from "react";

/**
 * The namespace every persisted view preference is stored under.
 *
 * Preferences are per-person AND per-thing: "hide done items" is an answer
 * about THIS project, and two accounts sharing a browser must not inherit each
 * other's filters. Rather than drill a key through every panel into every child
 * view, the scope composes down the tree — a shell layout contributes the
 * viewer, a panel contributes the project — and `usePersistedState` reads the
 * joined result. Nesting is what makes a deep child (a gantt inside a backlog
 * panel) automatically project-scoped without knowing a project exists.
 *
 * The default is empty: a component rendered outside any provider still works,
 * it just shares one unscoped bucket. That keeps the hook usable on
 * public/pre-auth screens instead of throwing there.
 */
const PreferenceScopeContext = createContext<string>("");

export function PreferenceScopeProvider({
  scope,
  children,
}: {
  /**
   * One segment, prefixed by what it names so two ids can never collide —
   * `u:<userId>`, `project:<projectId>`, `org:<orgSlug>`.
   */
  scope: string;
  children: React.ReactNode;
}) {
  const parent = useContext(PreferenceScopeContext);
  const value = useMemo(
    () => (parent ? `${parent}:${scope}` : scope),
    [parent, scope],
  );

  return (
    <PreferenceScopeContext.Provider value={value}>
      {children}
    </PreferenceScopeContext.Provider>
  );
}

export function usePreferenceScope() {
  return useContext(PreferenceScopeContext);
}
