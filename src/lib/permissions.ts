import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements as adminDefaultStatements,
  adminAc as adminUserAc,
  userAc,
} from "better-auth/plugins/admin/access";
import {
  memberAc,
  adminAc as orgAdminAc,
  defaultStatements as orgDefaultStatements,
  ownerAc,
} from "better-auth/plugins/organization/access";

// Platform-level (admin plugin) access control.
export const ac = createAccessControl(adminDefaultStatements);

export const roles = {
  user: userAc,
  admin: adminUserAc,
  // Only role that may impersonate other admins; see auth.ts adminRoles.
  superadmin: ac.newRole({
    ...adminUserAc.statements,
    user: ["impersonate-admins", ...adminUserAc.statements.user],
  }),
};

// Organization-level access control. Extends Better Auth's built-in
// statements (organization/member/invitation) with this app's own
// `project` and `projectMember` resources, so project CRUD and project
// membership management (src/lib/actions/projects.ts,
// src/lib/actions/project-members.ts) are gated the same way as everything
// else. `projectMember` is the org-level bypass: owners/admins manage any
// project's members, while everyone else falls back to their per-project
// Scrum role (see src/lib/project-permissions.ts).
export const orgStatement = {
  ...orgDefaultStatements,
  project: ["create", "update", "delete"],
  projectMember: ["create", "update", "delete"],
  projectRole: ["create", "update", "delete"],
  // Teams are an org-level grouping only (assign/filter work); they never
  // grant access, so this gate is purely about who can manage the groups.
  team: ["create", "update", "delete"],
  // Shared working-time calendars (src/lib/actions/holidays.ts). Org-scoped
  // because one calendar serves many projects. A member's OWN leave and
  // working pattern are not gated here — everyone manages their own; this
  // covers the shared non-working days and editing someone else's roster.
  holidayCalendar: ["create", "update", "delete"],
  // The org's AI provider settings (src/lib/actions/ai.ts). `read` covers
  // seeing which provider/models are active; `update` covers changing them and
  // storing an API key. Whether the org may inherit the *platform* config is
  // not gated here — that's a platform-admin grant on
  // organization.aiPlatformAccess.
  aiConfig: ["read", "update"],
} as const;

export const orgAc = createAccessControl(orgStatement);

export const orgRoles = {
  member: orgAc.newRole({
    ...memberAc.statements,
    project: [],
    projectMember: [],
    projectRole: [],
    team: [],
    holidayCalendar: [],
    aiConfig: [],
  }),
  admin: orgAc.newRole({
    ...orgAdminAc.statements,
    project: ["create", "update", "delete"],
    projectMember: ["create", "update", "delete"],
    projectRole: ["create", "update", "delete"],
    team: ["create", "update", "delete"],
    holidayCalendar: ["create", "update", "delete"],
    aiConfig: ["read", "update"],
  }),
  owner: orgAc.newRole({
    ...ownerAc.statements,
    project: ["create", "update", "delete"],
    projectMember: ["create", "update", "delete"],
    projectRole: ["create", "update", "delete"],
    team: ["create", "update", "delete"],
    holidayCalendar: ["create", "update", "delete"],
    aiConfig: ["read", "update"],
  }),
};
