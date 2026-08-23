"use client";

import { createContext, useContext } from "react";

export type OrgContextValue = {
  id: string;
  slug: string;
  name: string;
  logo: string | null;
  role: string;
};

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({
  organization,
  children,
}: {
  organization: OrgContextValue;
  children: React.ReactNode;
}) {
  return (
    <OrgContext.Provider value={organization}>{children}</OrgContext.Provider>
  );
}

export function useOrg() {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error("useOrg must be used within an OrgProvider.");
  }
  return context;
}
