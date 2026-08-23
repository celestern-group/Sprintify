"use client";

import { IconPlus } from "@tabler/icons-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { OrganizationFormDialog } from "@/components/admin/organization-form-dialog";
import { OrganizationRowMenu } from "@/components/admin/organization-row-menu";
import { PageHeader } from "@/components/app/page-header";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { reviveString, usePersistedState } from "@/hooks/use-persisted-state";
import {
  listOrganizations,
  type OrganizationRow,
} from "@/lib/actions/admin-organizations";

const PAGE_SIZE = 10;

export function OrganizationsTable() {
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const [total, setTotal] = useState(0);
  // Persisted; the page number isn't (see UsersTable).
  const [search, setSearch] = usePersistedState<string>(
    "admin.organizations.search",
    "",
    reviveString,
  );
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { organizations: rows, total: nextTotal } = await listOrganizations({
      search: search || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
    setOrganizations(rows);
    setTotal(nextTotal);
    setLoading(false);
  }, [page, search]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Platform admin"
        title="Organizations"
        description={`${total} organization${total === 1 ? "" : "s"} across the platform.`}
      >
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <IconPlus />
          Create organization
        </Button>
      </PageHeader>

      <Card>
        <CardHeader className="border-b [.border-b]:pb-6">
          <CardTitle>All organizations</CardTitle>
          <Input
            placeholder="Search by name or slug…"
            value={search}
            onChange={(event) => {
              setPage(0);
              setSearch(event.target.value);
            }}
            className="max-w-sm"
          />
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-(--card-spacing)">Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Members</TableHead>
                <TableHead className="w-10 pr-(--card-spacing)" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center">
                    <Spinner className="mx-auto" />
                  </TableCell>
                </TableRow>
              ) : organizations.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No organizations found.
                  </TableCell>
                </TableRow>
              ) : (
                organizations.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="pl-(--card-spacing)">
                      <Link
                        href={`/admin/organizations/${org.id}`}
                        className="text-brand hover:underline"
                      >
                        {org.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {org.slug}
                    </TableCell>
                    <TableCell>
                      {org.ownerName ? (
                        <div className="flex flex-col">
                          <span className="text-sm">{org.ownerName}</span>
                          <span className="text-xs text-muted-foreground">
                            {org.ownerEmail}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          No owner
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {org.memberCount}
                    </TableCell>
                    <TableCell className="pr-(--card-spacing)">
                      <OrganizationRowMenu
                        organization={org}
                        onChanged={load}
                      />
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
            disabled={page === 0}
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
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </CardFooter>
      </Card>

      <OrganizationFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onDone={load}
      />
    </PageContainer>
  );
}
