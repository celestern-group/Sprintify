const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export function hasAdminRole(role: string | null | undefined) {
  if (!role) return false;
  return role.split(",").some((r) => ADMIN_ROLES.has(r.trim()));
}

const ORG_MANAGE_ROLES = new Set(["owner", "admin"]);

export function canManageOrg(orgRole: string | null | undefined) {
  if (!orgRole) return false;
  return ORG_MANAGE_ROLES.has(orgRole);
}
