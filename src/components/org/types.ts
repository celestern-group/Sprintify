import type { auth } from "@/lib/auth";

export type FullOrganization = NonNullable<
  Awaited<ReturnType<typeof auth.api.getFullOrganization>>
>;

export type OrgMember = FullOrganization["members"][number];
export type OrgInvitation = FullOrganization["invitations"][number];
