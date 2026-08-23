"use client";

import { useCallback } from "react";
import { AuditLogTable } from "@/components/audit/audit-log-table";
import { type AuditLogPage, listOrgAuditLog } from "@/lib/actions/audit";

// Binds the org slug into the loader so the shared table stays scope-agnostic.
export function OrgAuditLogPanel({ slug }: { slug: string }) {
  const load = useCallback(
    (params: {
      search?: string;
      action?: string;
      limit: number;
      offset: number;
    }): Promise<AuditLogPage> => listOrgAuditLog({ slug, ...params }),
    [slug],
  );

  return <AuditLogTable eyebrow="Organization" title="Audit log" load={load} />;
}
