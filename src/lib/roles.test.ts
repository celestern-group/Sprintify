import { describe, expect, it } from "vitest";
import { canManageOrg, hasAdminRole } from "@/lib/roles";

describe("hasAdminRole", () => {
  it("is false for null/undefined/empty", () => {
    expect(hasAdminRole(null)).toBe(false);
    expect(hasAdminRole(undefined)).toBe(false);
    expect(hasAdminRole("")).toBe(false);
  });

  it("recognizes admin and superadmin", () => {
    expect(hasAdminRole("admin")).toBe(true);
    expect(hasAdminRole("superadmin")).toBe(true);
  });

  it("handles comma-separated role lists with whitespace", () => {
    expect(hasAdminRole("user,admin")).toBe(true);
    expect(hasAdminRole("user, superadmin ")).toBe(true);
    expect(hasAdminRole("user,editor")).toBe(false);
  });

  it("does not treat a plain user as admin", () => {
    expect(hasAdminRole("user")).toBe(false);
  });
});

describe("canManageOrg", () => {
  it("allows owner and admin only", () => {
    expect(canManageOrg("owner")).toBe(true);
    expect(canManageOrg("admin")).toBe(true);
    expect(canManageOrg("member")).toBe(false);
    expect(canManageOrg(null)).toBe(false);
  });
});
