// The permission catalog for project roles.
//
// Roles themselves are DATA (the `projectRole` table) so organizations can
// create their own and an external HR system can eventually sync job functions
// we've never heard of. Permissions are CODE, because a permission is only
// meaningful if something in this codebase enforces it — that split is what
// lets outside systems invent roles without inventing capabilities.
//
// Two consequences worth knowing:
//
//  - Role *names* mean nothing to the code. Never branch on a role name; check
//    a permission key. `key` exists only as a stable identifier for external
//    mapping, which is why it's immutable once created.
//  - `role:manage` is a project-scope superuser: whoever holds it can create a
//    project-local role granting `member:manage` and assign it to themselves.
//    That's bounded to their own project and is intended, not a bug.
//
// Client-safe: no db or server imports, so the role editor UI and the server
// actions share exactly one definition of what a permission is.

export const PROJECT_PERMISSION_GROUPS = [
  { id: "project", label: "Project" },
  { id: "member", label: "People" },
  { id: "role", label: "Roles" },
  { id: "backlog", label: "Backlog" },
  { id: "sprint", label: "Sprints" },
  { id: "capacity", label: "Capacity" },
  { id: "item", label: "Work items" },
  { id: "comment", label: "Comments" },
  { id: "attachment", label: "Attachments" },
] as const;

export type ProjectPermissionGroupId =
  (typeof PROJECT_PERMISSION_GROUPS)[number]["id"];

// `enforced: false` means the feature doesn't exist yet. Those keys are still
// storable and assignable — an HR sync will hand us role definitions before the
// matching features ship, and admins should be able to configure ahead of time.
// The UI marks them; no server check reads them until the feature lands.
export const PROJECT_PERMISSIONS = [
  {
    key: "project:view",
    group: "project",
    label: "View project",
    enforced: true,
  },
  {
    key: "project:update",
    group: "project",
    label: "Edit project details",
    enforced: false,
  },
  {
    key: "member:view",
    group: "member",
    label: "View members",
    enforced: true,
  },
  {
    key: "member:manage",
    group: "member",
    label: "Add and remove members",
    enforced: true,
  },
  {
    key: "role:manage",
    group: "role",
    label: "Manage project roles",
    enforced: true,
  },
  {
    key: "backlog:view",
    group: "backlog",
    label: "View backlog",
    enforced: true,
  },
  {
    key: "backlog:prioritize",
    group: "backlog",
    label: "Reorder the backlog",
    enforced: true,
  },
  {
    key: "sprint:view",
    group: "sprint",
    label: "View sprints",
    enforced: true,
  },
  {
    key: "sprint:create",
    group: "sprint",
    label: "Create sprints",
    enforced: true,
  },
  {
    key: "sprint:manage",
    group: "sprint",
    label: "Start and close sprints",
    enforced: true,
  },
  {
    key: "capacity:view",
    group: "capacity",
    label: "View sprint capacity",
    enforced: true,
  },
  {
    // Editing your OWN capacity and leave never needs a permission — this key
    // is only about editing someone else's on a shared project.
    key: "capacity:manage",
    group: "capacity",
    label: "Edit anyone's capacity",
    enforced: true,
  },
  {
    key: "item:create",
    group: "item",
    label: "Create work items",
    enforced: true,
  },
  {
    key: "item:update",
    group: "item",
    label: "Edit work items",
    enforced: true,
  },
  {
    key: "item:delete",
    group: "item",
    label: "Delete work items",
    enforced: true,
  },
  {
    key: "item:assign",
    group: "item",
    label: "Assign work items",
    enforced: true,
  },
  {
    // Deliberately NOT folded into backlog:view. Reading a thread and adding
    // to it are different acts — the Viewer role exists to be read-only, and
    // an auditor/stakeholder seat that can post is not read-only.
    key: "comment:create",
    group: "comment",
    label: "Write comments",
    enforced: true,
  },
  {
    // Editing your OWN comment never needs a permission — this key is only
    // about removing someone ELSE's, the same shape as capacity:manage.
    key: "comment:moderate",
    group: "comment",
    label: "Delete anyone's comment",
    enforced: true,
  },
  {
    // Its own key rather than item:update, because uploading a file is a
    // different act from editing the item's text: a QA or support seat that
    // should attach a screenshot and a log is exactly who shouldn't be able to
    // rewrite the acceptance criteria. Viewer holds neither.
    key: "attachment:create",
    group: "attachment",
    label: "Add attachments",
    enforced: true,
  },
  {
    // Removing or renaming your OWN upload never needs a permission — this key
    // is only about someone ELSE's, the same shape as comment:moderate.
    key: "attachment:manage",
    group: "attachment",
    label: "Manage anyone's attachments",
    enforced: true,
  },
] as const satisfies readonly {
  key: string;
  group: ProjectPermissionGroupId;
  label: string;
  enforced: boolean;
}[];

export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number];
export type ProjectPermissionKey = ProjectPermission["key"];

export const PROJECT_PERMISSION_KEYS: readonly ProjectPermissionKey[] =
  PROJECT_PERMISSIONS.map((permission) => permission.key);

export function isProjectPermissionKey(
  value: unknown,
): value is ProjectPermissionKey {
  return (
    typeof value === "string" &&
    (PROJECT_PERMISSION_KEYS as readonly string[]).includes(value)
  );
}

// Every read and write path goes through this. Stored rows outlive catalog
// changes and synced payloads carry whatever the remote system sent, so unknown
// keys are dropped rather than trusted. Ordering by catalog order keeps stored
// arrays diff-stable.
//
// Note: dropping an unknown key is a silent permission loss, so renaming a key
// in the catalog above requires its own data migration.
export function sanitizeProjectPermissions(
  input: unknown,
): ProjectPermissionKey[] {
  if (!Array.isArray(input)) return [];
  const wanted = new Set(input.filter(isProjectPermissionKey));
  return PROJECT_PERMISSION_KEYS.filter((key) => wanted.has(key));
}

export function projectRoleCan(
  permissions: readonly string[] | null | undefined,
  permission: ProjectPermissionKey,
): boolean {
  return permissions?.includes(permission) ?? false;
}

export function permissionsByGroup(
  permissions: readonly string[],
): Record<ProjectPermissionGroupId, ProjectPermissionKey[]> {
  const grouped = {} as Record<
    ProjectPermissionGroupId,
    ProjectPermissionKey[]
  >;
  for (const group of PROJECT_PERMISSION_GROUPS) grouped[group.id] = [];
  for (const permission of PROJECT_PERMISSIONS) {
    if (permissions.includes(permission.key)) {
      grouped[permission.group].push(permission.key);
    }
  }
  return grouped;
}

// The client previews this while typing a role name; the server always
// re-derives it rather than trusting what the client submitted.
export function slugifyRoleKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export const DEFAULT_PROJECT_ROLE_KEY = "developer";

// The catalog every organization starts with. Consumed by BOTH the seeding
// migration and the afterCreateOrganization hook, so existing and new orgs
// can't drift apart.
export const SEED_PROJECT_ROLES: readonly {
  key: string;
  name: string;
  description: string;
  permissions: readonly ProjectPermissionKey[];
  isDefault: boolean;
}[] = [
  {
    key: "product_owner",
    name: "Product owner",
    description: "Owns the backlog and the product direction.",
    isDefault: false,
    permissions: [
      "project:view",
      "project:update",
      "member:view",
      "member:manage",
      "role:manage",
      "backlog:view",
      "backlog:prioritize",
      "sprint:view",
      "sprint:create",
      "sprint:manage",
      "capacity:view",
      "capacity:manage",
      "item:create",
      "item:update",
      "item:delete",
      "item:assign",
      "comment:create",
      "comment:moderate",
      "attachment:create",
      "attachment:manage",
    ],
  },
  {
    key: "scrum_master",
    name: "Scrum master",
    description: "Runs the process and keeps the team unblocked.",
    isDefault: false,
    permissions: [
      "project:view",
      "member:view",
      "member:manage",
      "role:manage",
      "backlog:view",
      "sprint:view",
      "sprint:create",
      "sprint:manage",
      "capacity:view",
      "capacity:manage",
      "item:update",
      "item:assign",
      "comment:create",
      "comment:moderate",
      "attachment:create",
      "attachment:manage",
    ],
  },
  {
    key: DEFAULT_PROJECT_ROLE_KEY,
    name: "Developer",
    description: "Delivers the work in the sprint.",
    isDefault: true,
    permissions: [
      "project:view",
      "member:view",
      "backlog:view",
      "sprint:view",
      "capacity:view",
      "item:create",
      "item:update",
      "item:assign",
      "comment:create",
      "attachment:create",
    ],
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to the project.",
    isDefault: false,
    permissions: [
      "project:view",
      "member:view",
      "backlog:view",
      "sprint:view",
      "capacity:view",
    ],
  },
];
