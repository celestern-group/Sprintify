"use client";

import { IconBuilding } from "@tabler/icons-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { reviveString, usePersistedState } from "@/hooks/use-persisted-state";
import {
  listOrganizationAiAccess,
  type OrganizationAiAccessRow,
  setOrganizationAiAccess,
} from "@/lib/actions/admin-ai";

const PAGE_SIZE = 10;

// The stored value is a nullable boolean — null means "follow the platform
// default" — so the control has to be tri-state. A switch can't express that.
const ACCESS_VALUES = ["default", "allowed", "denied"] as const;
type AccessValue = (typeof ACCESS_VALUES)[number];

function toAccessValue(allowed: boolean | null): AccessValue {
  if (allowed === null) return "default";
  return allowed ? "allowed" : "denied";
}

function fromAccessValue(value: AccessValue): boolean | null {
  if (value === "default") return null;
  return value === "allowed";
}

export function OrgAiAccessPanel() {
  const [organizations, setOrganizations] = useState<OrganizationAiAccessRow[]>(
    [],
  );
  const [total, setTotal] = useState(0);
  const [defaultOrgAccess, setDefaultOrgAccess] = useState(false);
  // Persisted; the page number isn't (see UsersTable).
  const [search, setSearch] = usePersistedState<string>(
    "admin.ai-access.search",
    "",
    reviveString,
  );
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listOrganizationAiAccess({
        search: search || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setOrganizations(result.organizations);
      setTotal(result.total);
      setDefaultOrgAccess(result.defaultOrgAccess);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load organizations.",
      );
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function change(row: OrganizationAiAccessRow, value: AccessValue) {
    const allowed = fromAccessValue(value);
    setPendingId(row.id);
    // Optimistic: the select is the only thing that changes, and a failure
    // reloads the true state below.
    setOrganizations((rows) =>
      rows.map((item) =>
        item.id === row.id ? { ...item, aiPlatformAccess: allowed } : item,
      ),
    );
    try {
      await setOrganizationAiAccess({
        organizationId: row.id,
        allowed,
      });
      toast.success(
        allowed === null
          ? `${row.name} now follows the platform default.`
          : allowed
            ? `${row.name} can use the shared AI configuration.`
            : `${row.name} can no longer use the shared AI configuration.`,
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Unable to update access.",
      );
      await load();
    } finally {
      setPendingId(null);
    }
  }

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-6">
        <div className="flex items-center gap-2">
          <IconBuilding className="size-4 text-muted-foreground" />
          <CardTitle>Organization access</CardTitle>
        </div>
        <CardDescription>
          Choose which organizations may use the shared configuration.{" "}
          <span className="font-semibold">Default</span> follows the
          platform-wide setting above, which is currently{" "}
          <span className="font-semibold">
            {defaultOrgAccess ? "allow" : "deny"}
          </span>
          . Denied organizations can still configure their own provider.
        </CardDescription>
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          placeholder="Search organizations…"
          aria-label="Search organizations"
          className="mt-2 max-w-xs"
        />
      </CardHeader>
      <CardContent className="pt-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading organizations…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </div>
        ) : organizations.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {search
              ? "No organizations match that search."
              : "There are no organizations yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Members
                  </TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead className="text-right">Shared AI access</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations.map((row) => {
                  const effective = row.aiPlatformAccess ?? defaultOrgAccess;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="min-w-0">
                        <Link
                          href={`/admin/organizations/${row.id}`}
                          className="font-semibold hover:underline"
                        >
                          {row.name}
                        </Link>
                        <div className="truncate text-xs text-muted-foreground">
                          /{row.slug}
                        </div>
                      </TableCell>
                      <TableCell className="hidden tabular-nums sm:table-cell">
                        {row.memberCount}
                      </TableCell>
                      <TableCell>
                        {effective ? (
                          <Badge variant="success">Allowed</Badge>
                        ) : (
                          <Badge variant="neutral">Denied</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <NativeSelect
                          aria-label={`Shared AI access for ${row.name}`}
                          value={toAccessValue(row.aiPlatformAccess)}
                          disabled={pendingId === row.id}
                          onChange={(event) =>
                            change(row, event.target.value as AccessValue)
                          }
                          className="ml-auto w-40"
                        >
                          <NativeSelectOption value="default">
                            Default
                          </NativeSelectOption>
                          <NativeSelectOption value="allowed">
                            Allowed
                          </NativeSelectOption>
                          <NativeSelectOption value="denied">
                            Denied
                          </NativeSelectOption>
                        </NativeSelect>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {total > PAGE_SIZE ? (
        <CardFooter className="flex items-center justify-between gap-2 border-t pt-6">
          <span className="text-sm text-muted-foreground tabular-nums">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of{" "}
            {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={page === 0 || loading}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.min(lastPage, value + 1))}
              disabled={page >= lastPage || loading}
            >
              Next
            </Button>
          </div>
        </CardFooter>
      ) : null}
    </Card>
  );
}
