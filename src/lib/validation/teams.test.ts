import { describe, expect, it } from "vitest";
import {
  createTeamSchema,
  syncExternalTeamsSchema,
  teamMemberSchema,
  updateTeamSchema,
} from "@/lib/validation/teams";

describe("createTeamSchema", () => {
  it("accepts a valid team and trims the name", () => {
    const parsed = createTeamSchema.parse({
      organizationId: "org_1",
      name: "  Platform  ",
      description: "  Owns the platform  ",
    });
    expect(parsed.name).toBe("Platform");
    expect(parsed.description).toBe("Owns the platform");
  });

  it("rejects an empty (whitespace-only) name", () => {
    expect(() =>
      createTeamSchema.parse({ organizationId: "org_1", name: "   " }),
    ).toThrow();
  });

  it("rejects names longer than 200 characters", () => {
    expect(() =>
      createTeamSchema.parse({
        organizationId: "org_1",
        name: "a".repeat(201),
      }),
    ).toThrow();
  });

  it("requires an organizationId", () => {
    expect(() => createTeamSchema.parse({ name: "Platform" })).toThrow();
  });
});

describe("updateTeamSchema", () => {
  it("requires teamId and a valid name", () => {
    expect(updateTeamSchema.parse({ teamId: "t1", name: "  Ops  " })).toEqual({
      teamId: "t1",
      name: "Ops",
    });
    expect(() => updateTeamSchema.parse({ teamId: "t1", name: "" })).toThrow();
    expect(() => updateTeamSchema.parse({ name: "Ops" })).toThrow();
  });
});

describe("teamMemberSchema", () => {
  it("requires both ids to be non-empty", () => {
    expect(teamMemberSchema.parse({ teamId: "t1", memberId: "m1" })).toEqual({
      teamId: "t1",
      memberId: "m1",
    });
    expect(() =>
      teamMemberSchema.parse({ teamId: "", memberId: "m1" }),
    ).toThrow();
  });
});

describe("syncExternalTeamsSchema", () => {
  it("requires source to be the literal 'sap' and at least one team", () => {
    expect(() =>
      syncExternalTeamsSchema.parse({
        organizationId: "org_1",
        source: "workday",
        teams: [{ externalId: "x1", name: "Ops" }],
      }),
    ).toThrow();
    expect(() =>
      syncExternalTeamsSchema.parse({
        organizationId: "org_1",
        source: "sap",
        teams: [],
      }),
    ).toThrow();
  });

  it("accepts a well-formed sync payload", () => {
    const parsed = syncExternalTeamsSchema.parse({
      organizationId: "org_1",
      source: "sap",
      teams: [{ externalId: "x1", name: "Ops", description: "Operations" }],
    });
    expect(parsed.teams).toHaveLength(1);
    expect(parsed.teams[0].externalId).toBe("x1");
  });
});
