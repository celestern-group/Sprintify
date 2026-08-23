"use client";

import { IconEye, IconHistory } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import type { AuditLogPage, AuditLogRow } from "@/lib/actions/audit";

const PAGE_SIZE = 20;

type LoadParams = {
  search?: string;
  action?: string;
  organizationId?: string;
  limit: number;
  offset: number;
};

// The action string is namespaced `subject.verb` (e.g. `ssoProvider.created`).
// Colour the lozenge by verb so create/delete/update read at a glance, while
// keeping the raw action visible — colour is never the only signal.
function actionVariant(action: string) {
  const verb = action.split(".").at(-1)?.toLowerCase() ?? "";
  if (/(delete|remove|revoke|disable|lock)/.test(verb)) return "destructive";
  if (/(create|add|invite|grant|enable)/.test(verb)) return "success";
  if (/(update|change|assign|rename|edit)/.test(verb)) return "default";
  return "neutral";
}

function formatTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AuditLogTable({
  eyebrow,
  title,
  description,
  showOrgColumn = false,
  load,
  loadOrganizations,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  showOrgColumn?: boolean;
  load: (params: LoadParams) => Promise<AuditLogPage>;
  loadOrganizations?: () => Promise<{ id: string; name: string }[]>;
}) {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [organizations, setOrganizations] = useState<
    { id: string; name: string }[]
  >([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AuditLogRow | null>(null);

  const runLoad = useCallback(async () => {
    setLoading(true);
    try {
      const result = await load({
        search: search || undefined,
        action: action || undefined,
        organizationId: organizationId || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setRows(result.rows);
      setTotal(result.total);
      setActions(result.actions);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load audit log.",
      );
    } finally {
      setLoading(false);
    }
  }, [load, search, action, organizationId, page]);

  useEffect(() => {
    runLoad();
  }, [runLoad]);

  useEffect(() => {
    if (!loadOrganizations) return;
    loadOrganizations()
      .then(setOrganizations)
      .catch(() => setOrganizations([]));
  }, [loadOrganizations]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const colSpan = showOrgColumn ? 5 : 4;

  return (
    <PageContainer>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={
          description ??
          `${total.toLocaleString()} recorded event${total === 1 ? "" : "s"}.`
        }
      />

      <Card>
        <CardHeader className="gap-3 border-b [.border-b]:pb-6">
          <CardTitle>Events</CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Input
              placeholder="Search actor, action, or target id…"
              value={search}
              onChange={(event) => {
                setPage(0);
                setSearch(event.target.value);
              }}
              className="sm:max-w-xs"
            />
            <NativeSelect
              size="sm"
              value={action}
              onChange={(event) => {
                setPage(0);
                setAction(event.target.value);
              }}
              className="sm:w-56"
              aria-label="Filter by action"
            >
              <NativeSelectOption value="">All actions</NativeSelectOption>
              {actions.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {value}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {loadOrganizations ? (
              <NativeSelect
                size="sm"
                value={organizationId}
                onChange={(event) => {
                  setPage(0);
                  setOrganizationId(event.target.value);
                }}
                className="sm:w-56"
                aria-label="Filter by organization"
              >
                <NativeSelectOption value="">
                  All organizations
                </NativeSelectOption>
                {organizations.map((org) => (
                  <NativeSelectOption key={org.id} value={org.id}>
                    {org.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-(--card-spacing)">Event</TableHead>
                <TableHead>Actor</TableHead>
                {showOrgColumn ? <TableHead>Organization</TableHead> : null}
                <TableHead>When</TableHead>
                <TableHead className="w-10 pr-(--card-spacing)" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={colSpan} className="py-8 text-center">
                    <Spinner className="mx-auto" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={colSpan}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No audit events match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-(--card-spacing)">
                      <div className="flex flex-col gap-1">
                        <Badge variant={actionVariant(row.action)}>
                          {row.action}
                        </Badge>
                        {row.targetType ? (
                          <span className="text-xs text-muted-foreground">
                            {row.targetType}
                            {row.targetId ? (
                              <span className="font-mono">
                                {" "}
                                · {row.targetId}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.actorName || row.actorEmail ? (
                        <div className="flex flex-col">
                          <span className="text-sm">
                            {row.actorName ?? row.actorEmail}
                          </span>
                          {row.actorName && row.actorEmail ? (
                            <span className="text-xs text-muted-foreground">
                              {row.actorEmail}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          System
                        </span>
                      )}
                    </TableCell>
                    {showOrgColumn ? (
                      <TableCell className="text-sm text-muted-foreground">
                        {row.organizationName ?? (
                          <span className="italic">Platform</span>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="pr-(--card-spacing)">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="View event details"
                        onClick={() => setDetail(row)}
                      >
                        <IconEye />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        <CardFooter className="justify-between border-t [.border-t]:pt-6">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </CardFooter>
      </Card>

      <Dialog
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconHistory className="size-4 shrink-0" />
              <span className="min-w-0 truncate font-mono text-sm">
                {detail?.action}
              </span>
            </DialogTitle>
            <DialogDescription>
              {detail ? formatTime(detail.createdAt) : null}
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <dl className="grid grid-cols-1 gap-3 text-sm">
              <DetailRow label="Actor">
                {detail.actorName || detail.actorEmail ? (
                  <span className="min-w-0 break-words">
                    {detail.actorName ?? detail.actorEmail}
                    {detail.actorName && detail.actorEmail
                      ? ` · ${detail.actorEmail}`
                      : ""}
                  </span>
                ) : (
                  <span className="text-muted-foreground">System</span>
                )}
              </DetailRow>
              {showOrgColumn ? (
                <DetailRow label="Organization">
                  {detail.organizationName ?? (
                    <span className="text-muted-foreground italic">
                      Platform
                    </span>
                  )}
                </DetailRow>
              ) : null}
              <DetailRow label="Target">
                {detail.targetType ? (
                  <span className="min-w-0 break-words">
                    {detail.targetType}
                    {detail.targetId ? (
                      <span className="font-mono"> · {detail.targetId}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </DetailRow>
              <DetailRow label="IP address">
                {detail.ipAddress ? (
                  <span className="font-mono">{detail.ipAddress}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </DetailRow>
              <div className="flex flex-col gap-1.5">
                <dt className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                  Metadata
                </dt>
                <dd className="min-w-0">
                  {detail.metadata &&
                  Object.keys(detail.metadata).length > 0 ? (
                    <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
                      {JSON.stringify(detail.metadata, null, 2)}
                    </pre>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      No metadata recorded.
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          ) : null}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
      <dt className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
