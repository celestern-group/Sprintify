import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_ROLE_KEY,
  isProjectPermissionKey,
  PROJECT_PERMISSION_KEYS,
  projectRoleCan,
  SEED_PROJECT_ROLES,
  sanitizeProjectPermissions,
  slugifyRoleKey,
} from "@/lib/project-permissions";

describe("isProjectPermissionKey", () => {
  it("accepts known keys and rejects everything else", () => {
    expect(isProjectPermissionKey("project:view")).toBe(true);
    expect(isProjectPermissionKey("item:create")).toBe(true);
    expect(isProjectPermissionKey("not:a:key")).toBe(false);
    expect(isProjectPermissionKey(42)).toBe(false);
    expect(isProjectPermissionKey(null)).toBe(false);
  });
});

describe("sanitizeProjectPermissions", () => {
  it("drops unknown keys and dedupes", () => {
    expect(
      sanitizeProjectPermissions([
        "project:view",
        "bogus",
        "project:view",
        "member:view",
      ]),
    ).toEqual(["project:view", "member:view"]);
  });

  it("returns [] for non-arrays", () => {
    expect(sanitizeProjectPermissions(null)).toEqual([]);
    expect(sanitizeProjectPermissions("project:view")).toEqual([]);
    expect(sanitizeProjectPermissions(undefined)).toEqual([]);
  });

  it("is stable in catalog order regardless of input order", () => {
    const a = sanitizeProjectPermissions(["member:view", "project:view"]);
    const b = sanitizeProjectPermissions(["project:view", "member:view"]);
    expect(a).toEqual(b);
  });
});

describe("projectRoleCan", () => {
  it("checks membership, tolerating null/undefined", () => {
    expect(projectRoleCan(["role:manage"], "role:manage")).toBe(true);
    expect(projectRoleCan(["project:view"], "role:manage")).toBe(false);
    expect(projectRoleCan(null, "project:view")).toBe(false);
    expect(projectRoleCan(undefined, "project:view")).toBe(false);
  });
});

describe("slugifyRoleKey", () => {
  it("lowercases, collapses non-alphanumerics, trims underscores", () => {
    expect(slugifyRoleKey("Product Owner")).toBe("product_owner");
    expect(slugifyRoleKey("  Scrum/Master!! ")).toBe("scrum_master");
    expect(slugifyRoleKey("QA & Test")).toBe("qa_test");
  });

  it("caps length at 48 characters", () => {
    expect(slugifyRoleKey("a".repeat(80)).length).toBe(48);
  });
});

describe("SEED_PROJECT_ROLES", () => {
  it("has exactly one default role, matching DEFAULT_PROJECT_ROLE_KEY", () => {
    const defaults = SEED_PROJECT_ROLES.filter((r) => r.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].key).toBe(DEFAULT_PROJECT_ROLE_KEY);
  });

  it("only references permission keys that exist in the catalog", () => {
    for (const role of SEED_PROJECT_ROLES) {
      for (const perm of role.permissions) {
        expect(PROJECT_PERMISSION_KEYS).toContain(perm);
      }
    }
  });

  it("has unique role keys", () => {
    const keys = SEED_PROJECT_ROLES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
