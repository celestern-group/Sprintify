import { AuditLogTable } from "@/components/audit/audit-log-table";
import {
  listAuditOrganizations,
  listPlatformAuditLog,
} from "@/lib/actions/audit";

export default function AdminAuditPage() {
  return (
    <AuditLogTable
      eyebrow="Platform admin"
      title="Audit log"
      showOrgColumn
      load={listPlatformAuditLog}
      loadOrganizations={listAuditOrganizations}
    />
  );
}
