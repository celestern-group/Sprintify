"use client";

import { IconKey } from "@tabler/icons-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import type { AdminUser } from "@/components/admin/types";
import { UserRowMenu } from "@/components/admin/user-row-menu";
import { PageHeader } from "@/components/app/page-header";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
  getUsersSignInMethods,
  type UserSignInMethod,
} from "@/lib/actions/admin-users";
import { authClient } from "@/lib/auth-client";
import {
  type ProviderKind,
  SSO_PROVIDER_ICONS,
} from "@/lib/sso-provider-kinds";

const PAGE_SIZE = 10;

function SignInMethodBadge({ methods }: { methods: UserSignInMethod[] }) {
  const ssoMethods = methods.filter((m) => !m.isCredential);
  if (ssoMethods.length === 0) {
    return <span className="text-sm text-muted-foreground">Password</span>;
  }
  const [primary, ...rest] = ssoMethods;
  const Icon = SSO_PROVIDER_ICONS[primary.iconKey as ProviderKind] ?? IconKey;
  return (
    <Badge variant="neutral" className="normal-case">
      <Icon className="size-3" />
      {primary.displayName ?? primary.providerId}
      {rest.length > 0 ? ` +${rest.length}` : ""}
    </Badge>
  );
}

export function UsersTable() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [signInMethods, setSignInMethods] = useState<
    Record<string, UserSignInMethod[]>
  >({});
  const [total, setTotal] = useState(0);
  // The query persists, the page number doesn't: an offset means nothing
  // against a list that has moved on since, so a return trip starts at page 1
  // of whatever the remembered search now matches.
  const [search, setSearch] = usePersistedState<string>(
    "admin.users.search",
    "",
    reviveString,
  );
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await authClient.admin.listUsers({
      query: {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        ...(search
          ? {
              searchField: "email" as const,
              searchOperator: "contains" as const,
              searchValue: search,
            }
          : {}),
      },
    });
    setLoading(false);
    if (error || !data) {
      setLoadError(error?.message ?? "The user list couldn't be loaded.");
      return;
    }
    setUsers(data.users);
    setTotal(data.total);
    getUsersSignInMethods(data.users.map((u) => u.id))
      .then(setSignInMethods)
      .catch(() => setSignInMethods({}));
  }, [page, search]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Platform admin"
        title="Users"
        description={`${total} user${total === 1 ? "" : "s"} across the platform.`}
      >
        <CreateUserDialog onCreated={load} />
      </PageHeader>

      <Card>
        <CardHeader className="border-b [.border-b]:pb-6">
          <CardTitle>All users</CardTitle>
          <Input
            placeholder="Search by email…"
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
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Sign-in</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead className="w-10 pr-(--card-spacing)" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }, (_, index) => index).map((row) => (
                  <TableRow key={row}>
                    <TableCell className="pl-(--card-spacing)">
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-14" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell className="pr-(--card-spacing)" />
                  </TableRow>
                ))
              ) : loadError ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center">
                    <p className="text-sm text-destructive">{loadError}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={load}
                    >
                      Retry
                    </Button>
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="pl-(--card-spacing)">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="text-brand hover:underline"
                      >
                        {user.name}
                      </Link>
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant="neutral">{user.role ?? "user"}</Badge>
                    </TableCell>
                    <TableCell>
                      <SignInMethodBadge
                        methods={signInMethods[user.id] ?? []}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.banned ? "destructive" : "success"}>
                        {user.banned ? "Banned" : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.emailVerified ? (
                        <Badge variant="success">Verified</Badge>
                      ) : (
                        <Badge variant="neutral">Unverified</Badge>
                      )}
                    </TableCell>
                    <TableCell className="pr-(--card-spacing)">
                      <UserRowMenu user={user} onChanged={load} />
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
    </PageContainer>
  );
}
