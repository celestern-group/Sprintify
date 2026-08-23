import { z } from "zod";

// Input schemas for the team server actions, kept in a plain module so they can
// be unit-tested (a "use server" file may only export async functions) and
// shared by the actions in src/lib/actions/teams.ts.

export const teamNameSchema = z.string().trim().min(1).max(200);
export const teamDescriptionSchema = z.string().trim().max(2000).optional();

export const createTeamSchema = z.object({
  organizationId: z.string().min(1),
  name: teamNameSchema,
  description: teamDescriptionSchema,
});

export const updateTeamSchema = z.object({
  teamId: z.string().min(1),
  name: teamNameSchema,
  description: teamDescriptionSchema,
});

export const teamMemberSchema = z.object({
  teamId: z.string().min(1),
  memberId: z.string().min(1),
});

export const addTeamToProjectSchema = z.object({
  teamId: z.string().min(1),
  projectId: z.string().min(1),
});

export const syncExternalTeamsSchema = z.object({
  organizationId: z.string().min(1),
  source: z.literal("sap"),
  teams: z
    .array(
      z.object({
        externalId: z.string().min(1),
        name: teamNameSchema,
        description: teamDescriptionSchema,
      }),
    )
    .min(1),
});
