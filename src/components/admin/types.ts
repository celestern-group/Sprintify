import type { authClient } from "@/lib/auth-client";

type ListUsersResult = NonNullable<
  Awaited<ReturnType<typeof authClient.admin.listUsers>>["data"]
>;

export type AdminUser = ListUsersResult["users"][number];
