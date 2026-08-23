"use client";

import { IconBuilding, IconKey } from "@tabler/icons-react";
import { format, formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { AdminUser } from "@/components/admin/types";
import { UserRowMenu } from "@/components/admin/user-row-menu";
import { PageHeader } from "@/components/app/page-header";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import {
  getUserOrganizationsAdmin,
  getUsersSignInMethods,
  type UserOrganization,
  type UserSignInMethod,
} from "@/lib/actions/admin-users";
import { authClient } from "@/lib/auth-client";
import {
  type ProviderKind,
  SSO_PROVIDER_ICONS,
} from "@/lib/sso-provider-kinds";

export function UserDetail({ id }: { id: string }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [signInMethods, setSignInMethods] = useState<UserSignInMethod[]>([]);
  const [organizations, setOrganizations] = useState<UserOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, methodsByUser, orgs] = await Promise.all([
      authClient.admin.getUser({ query: { id } }),
      getUsersSignInMethods([id]),
      getUserOrganizationsAdmin(id),
    ]);
    setLoading(false);
    if (error || !data) {
      setNotFoundError(true);
      return;
    }
    setUser(data);
    setSignInMethods(methodsByUser[id] ?? []);
    setOrganizations(orgs);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (notFoundError) {
    notFound();
  }

  if (loading || !user) {
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Platform admin"
        title={user.name}
        description={user.email}
        backHref="/admin/users"
        backLabel="Users"
      >
        <UserRowMenu user={user} onChanged={load} />
      </PageHeader>

      <SectionCard title="Overview">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Role</dt>
            <dd>
              <Badge variant="neutral">{user.role ?? "user"}</Badge>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd>
              <Badge variant={user.banned ? "destructive" : "success"}>
                {user.banned ? "Banned" : "Active"}
              </Badge>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd>
              {user.emailVerified ? (
                <Badge variant="success">Verified</Badge>
              ) : (
                <Badge variant="neutral">Unverified</Badge>
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Joined</dt>
            <dd className="text-sm tabular-nums">
              {format(new Date(user.createdAt), "MMM d, yyyy")}
            </dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard
        title="Sign-in methods"
        description="How this user authenticates."
      >
        {signInMethods.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sign-in methods found.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {signInMethods.map((method) => {
              const Icon = method.isCredential
                ? IconKey
                : (SSO_PROVIDER_ICONS[method.iconKey as ProviderKind] ??
                  IconKey);
              return (
                <div
                  key={method.providerId}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                      <Icon className="size-4" />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">
                        {method.isCredential
                          ? "Password"
                          : (method.displayName ?? method.providerId)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        Linked{" "}
                        {formatDistanceToNow(new Date(method.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>
                  {method.isCredential ? null : (
                    <Badge variant="neutral" className="shrink-0">
                      SSO
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Organizations"
        description="Organizations this user is a member of."
      >
        {organizations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not a member of any organization.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {organizations.map((org) => (
              <Link
                key={org.id}
                href={`/manage-org/${org.slug}`}
                className="flex items-center justify-between gap-3 rounded-md border p-3 transition-colors hover:bg-muted"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                    <IconBuilding className="size-4" />
                  </div>
                  <span className="truncate text-sm font-medium">
                    {org.name}
                  </span>
                </div>
                <Badge variant="neutral" className="shrink-0">
                  {org.role}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </PageContainer>
  );
}
