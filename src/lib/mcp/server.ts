import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as Sentry from "@sentry/nextjs";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  member,
  organization,
  workflowStatus,
  workItem,
  workItemType,
} from "@/db/schema";
import {
  WORK_ITEM_FIELD_PLACEMENTS,
  WORK_ITEM_FIELD_TYPES,
  WORK_ITEM_TONES,
  WORKFLOW_STATUS_CATEGORIES,
} from "@/db/schema/work-items";
import {
  completeSprint,
  createSprint,
  deleteSprint,
  moveSprint,
  startSprint,
  updateSprint,
} from "@/lib/actions/sprints";
import {
  deleteWorkItemAttachment,
  getWorkItemAttachments,
  updateWorkItemAttachment,
} from "@/lib/actions/work-item-attachments";
import {
  createWorkItemComment,
  deleteWorkItemComment,
  getWorkItemCommentThread,
  toggleWorkItemCommentReaction,
  updateWorkItemComment,
} from "@/lib/actions/work-item-comments";
import {
  createWorkItemField,
  deleteWorkItemField,
  reorderWorkItemFields,
  updateWorkItemField,
} from "@/lib/actions/work-item-fields";
import {
  createWorkItemType,
  deleteWorkItemType,
  reorderWorkItemTypes,
  updateWorkItemType,
} from "@/lib/actions/work-item-types";
import {
  assignWorkItem,
  createWorkItem,
  deleteWorkItem,
  getBacklogData,
  getWorkItemDetail,
  linkWorkItems,
  moveWorkItem,
  moveWorkItems,
  rescheduleWorkItem,
  setWorkItemAttributes,
  setWorkItemParent,
  unlinkWorkItems,
  updateWorkItem,
} from "@/lib/actions/work-items";
import {
  createWorkflowStatus,
  deleteWorkflowStatus,
  reorderWorkflowStatuses,
  updateWorkflowStatus,
} from "@/lib/actions/workflow-statuses";
import { withMcpActor } from "@/lib/mcp/context";
import { listAccessibleProjects } from "@/lib/project-access";
import { projectRoleCan } from "@/lib/project-permissions";
import { WORK_ITEM_ICONS, workItemKey } from "@/lib/work-items";

type McpActor = { userId: string; canWrite: boolean };

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function toolError(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function organizationForActor(actor: McpActor, slug: string) {
  const [row] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(and(eq(organization.slug, slug), eq(member.userId, actor.userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Every tool resolves the API-key owner and reapplies the same
 * membership/project permissions as the web app. Mutations execute the
 * existing server actions under a short-lived MCP actor context, preserving
 * validation, audit records, notifications, and embeddings.
 */
export function createSprintifyMcpServer(actor: McpActor) {
  const server = new McpServer({ name: "sprintify", version: "0.1.0" });
  const writeDenied = () =>
    toolError(
      "This API key is read-only. Create an MCP key with write access.",
    );
  const write = async <T>(tool: string, operation: () => Promise<T>) => {
    if (!actor.canWrite) return writeDenied();
    try {
      return text(await withMcpActor(actor.userId, operation));
    } catch (error) {
      Sentry.captureException(error, { extra: { tool } });
      return toolError("Unable to complete this backlog operation right now.");
    }
  };

  server.registerTool(
    "list_organizations",
    {
      title: "List organizations",
      description:
        "List organizations available to the authenticated Sprintify user.",
      inputSchema: {},
    },
    async () => {
      try {
        const organizations = await db
          .select({ name: organization.name, slug: organization.slug })
          .from(organization)
          .innerJoin(member, eq(member.organizationId, organization.id))
          .where(eq(member.userId, actor.userId))
          .orderBy(asc(organization.name));
        return text({ organizations });
      } catch (error) {
        Sentry.captureException(error, {
          extra: { tool: "list_organizations" },
        });
        return toolError("Unable to list organizations right now.");
      }
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List accessible projects",
      description:
        "List projects the authenticated user can access in an organization.",
      inputSchema: { organizationSlug: z.string().min(1).max(128) },
    },
    async ({ organizationSlug }) => {
      try {
        const org = await organizationForActor(actor, organizationSlug);
        if (!org) return toolError("Organization not found.");
        const projects = await listAccessibleProjects(org.id, actor.userId);
        return text({
          organization: { name: org.name, slug: org.slug },
          projects,
        });
      } catch (error) {
        Sentry.captureException(error, { extra: { tool: "list_projects" } });
        return toolError("Unable to list projects right now.");
      }
    },
  );

  server.registerTool(
    "search_work_items",
    {
      title: "Search work items",
      description:
        "Search work-item summaries and descriptions in a project the authenticated user may view.",
      inputSchema: {
        organizationSlug: z.string().min(1).max(128),
        projectKey: z.string().min(1).max(32),
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    async ({ organizationSlug, projectKey, query, limit }) => {
      try {
        const org = await organizationForActor(actor, organizationSlug);
        if (!org) return toolError("Organization not found.");
        const project = (
          await listAccessibleProjects(org.id, actor.userId)
        ).find((candidate) => candidate.key === projectKey.toUpperCase());
        if (!project || !projectRoleCan(project.permissions, "backlog:view")) {
          return toolError("Project not found.");
        }

        const pattern = `%${query}%`;
        const items = await db
          .select({
            number: workItem.number,
            summary: workItem.summary,
            priority: workItem.priority,
            dueDate: workItem.dueDate,
            updatedAt: workItem.updatedAt,
            status: workflowStatus.name,
            statusCategory: workflowStatus.category,
            type: workItemType.name,
          })
          .from(workItem)
          .innerJoin(workflowStatus, eq(workflowStatus.id, workItem.statusId))
          .innerJoin(workItemType, eq(workItemType.id, workItem.typeId))
          .where(
            and(
              eq(workItem.projectId, project.id),
              or(
                ilike(workItem.summary, pattern),
                ilike(workItem.description, pattern),
              ),
            ),
          )
          .orderBy(asc(workItem.number))
          .limit(limit);
        return text({
          project: { key: project.key, name: project.name },
          items: items.map((item) => ({
            ...item,
            key: workItemKey(project.key, item.number),
          })),
        });
      } catch (error) {
        Sentry.captureException(error, {
          extra: { tool: "search_work_items" },
        });
        return toolError("Unable to search work items right now.");
      }
    },
  );

  server.registerTool(
    "get_backlog",
    {
      title: "Get project backlog",
      description:
        "Get the complete accessible backlog, including work items, statuses, types, sprints, members, and fields.",
      inputSchema: {
        organizationSlug: z.string().min(1).max(128),
        projectKey: z.string().min(1).max(32),
      },
    },
    async ({ organizationSlug, projectKey }) => {
      try {
        const org = await organizationForActor(actor, organizationSlug);
        if (!org) return toolError("Organization not found.");
        const project = (
          await listAccessibleProjects(org.id, actor.userId)
        ).find((candidate) => candidate.key === projectKey.toUpperCase());
        if (!project || !projectRoleCan(project.permissions, "backlog:view")) {
          return toolError("Project not found.");
        }
        return text(
          await withMcpActor(actor.userId, () =>
            getBacklogData({ organizationId: org.id, projectId: project.id }),
          ),
        );
      } catch (error) {
        Sentry.captureException(error, { extra: { tool: "get_backlog" } });
        return toolError("Unable to get this backlog right now.");
      }
    },
  );

  server.registerTool(
    "list_assigned_work_items",
    {
      title: "List assigned work items",
      description:
        "List visible work items assigned to a member, optionally narrowed to a sprint or status.",
      inputSchema: {
        organizationSlug: z.string().min(1).max(128),
        projectKey: z.string().min(1).max(32),
        assigneeMemberId: z.string().min(1).optional(),
        sprintId: z.string().min(1).optional(),
        statusId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(200).default(100),
      },
    },
    async ({
      organizationSlug,
      projectKey,
      assigneeMemberId,
      sprintId,
      statusId,
      limit,
    }) => {
      try {
        const org = await organizationForActor(actor, organizationSlug);
        if (!org) return toolError("Organization not found.");
        const project = (
          await listAccessibleProjects(org.id, actor.userId)
        ).find((candidate) => candidate.key === projectKey.toUpperCase());
        if (!project || !projectRoleCan(project.permissions, "backlog:view")) {
          return toolError("Project not found.");
        }
        const items = await db
          .select({
            id: workItem.id,
            number: workItem.number,
            summary: workItem.summary,
            assigneeMemberId: workItem.assigneeMemberId,
            sprintId: workItem.sprintId,
            priority: workItem.priority,
            status: workflowStatus.name,
            statusCategory: workflowStatus.category,
          })
          .from(workItem)
          .innerJoin(workflowStatus, eq(workflowStatus.id, workItem.statusId))
          .where(
            and(
              eq(workItem.projectId, project.id),
              assigneeMemberId
                ? eq(workItem.assigneeMemberId, assigneeMemberId)
                : undefined,
              sprintId ? eq(workItem.sprintId, sprintId) : undefined,
              statusId ? eq(workItem.statusId, statusId) : undefined,
            ),
          )
          .orderBy(asc(workItem.number))
          .limit(limit);
        return text({
          project: { key: project.key, name: project.name },
          items: items.map((item) => ({
            ...item,
            key: workItemKey(project.key, item.number),
          })),
        });
      } catch (error) {
        Sentry.captureException(error, {
          extra: { tool: "list_assigned_work_items" },
        });
        return toolError("Unable to list assigned work items right now.");
      }
    },
  );

  server.registerTool(
    "get_work_item",
    {
      title: "Get work item",
      description:
        "Get one accessible work item by its project key and number.",
      inputSchema: {
        organizationSlug: z.string().min(1).max(128),
        projectKey: z.string().min(1).max(32),
        number: z.number().int().positive(),
      },
    },
    async ({ organizationSlug, projectKey, number }) => {
      try {
        const org = await organizationForActor(actor, organizationSlug);
        if (!org) return toolError("Organization not found.");
        const project = (
          await listAccessibleProjects(org.id, actor.userId)
        ).find((candidate) => candidate.key === projectKey.toUpperCase());
        if (!project || !projectRoleCan(project.permissions, "backlog:view")) {
          return toolError("Project not found.");
        }
        const item = await withMcpActor(actor.userId, () =>
          getWorkItemDetail({
            organizationId: org.id,
            projectId: project.id,
            number,
          }),
        );
        return item ? text(item) : toolError("Work item not found.");
      } catch (error) {
        Sentry.captureException(error, { extra: { tool: "get_work_item" } });
        return toolError("Unable to get this work item right now.");
      }
    },
  );

  const itemInput = {
    typeId: z.string().min(1),
    statusId: z.string().min(1),
    summary: z.string().trim().min(1).max(300),
    description: z.string().max(20_000).optional(),
    acceptanceCriteria: z.string().max(20_000).optional(),
    technicalNotes: z.string().max(20_000).optional(),
    definitionOfDone: z.string().max(20_000).optional(),
    stepsToReproduce: z.string().max(20_000).optional(),
    expectedResult: z.string().max(20_000).optional(),
    actualResult: z.string().max(20_000).optional(),
    businessValue: z
      .enum(["low", "medium", "high", "critical"])
      .nullable()
      .optional(),
    riskLevel: z
      .enum(["low", "medium", "high", "critical"])
      .nullable()
      .optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    priority: z.enum(["lowest", "low", "medium", "high", "highest"]),
    points: z.number().min(0).max(10_000).nullable().optional(),
    actualEfforts: z.number().min(0).max(100_000).nullable().optional(),
    assigneeMemberId: z.string().min(1).nullable().optional(),
    parentId: z.string().min(1).nullable().optional(),
    sprintId: z.string().min(1).nullable().optional(),
    startDate: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  };

  server.registerTool(
    "create_work_item",
    {
      title: "Create work item",
      description:
        "Create a work item. Use IDs returned by get_backlog for project, type, status, sprint, and members.",
      inputSchema: { projectId: z.string().min(1), ...itemInput },
      annotations: { destructiveHint: false },
    },
    async ({ projectId, statusId, ...input }) =>
      write("create_work_item", () =>
        createWorkItem({ ...input, projectId, statusId }),
      ),
  );

  server.registerTool(
    "update_work_item",
    {
      title: "Update work item",
      description:
        "Replace the editable fields of a work item. Read it first to preserve fields you do not intend to change.",
      inputSchema: { workItemId: z.string().min(1), ...itemInput },
      annotations: { destructiveHint: false },
    },
    async ({ workItemId, ...input }) =>
      write("update_work_item", () => updateWorkItem({ workItemId, ...input })),
  );

  server.registerTool(
    "assign_work_item",
    {
      title: "Assign work item",
      description:
        "Assign a work item to a project member, or use null to unassign it.",
      inputSchema: {
        workItemId: z.string().min(1),
        assigneeMemberId: z.string().min(1).nullable(),
      },
      annotations: { destructiveHint: false },
    },
    async (input) => write("assign_work_item", () => assignWorkItem(input)),
  );

  server.registerTool(
    "set_work_item_attributes",
    {
      title: "Set work item attributes",
      description:
        "Bulk-set status, sprint, assignee, priority, or estimate for up to 200 items. Omit an attribute to leave it unchanged; null clears nullable attributes.",
      inputSchema: {
        workItemIds: z.array(z.string().min(1)).min(1).max(200),
        statusId: z.string().min(1).optional(),
        sprintId: z.string().min(1).nullable().optional(),
        assigneeMemberId: z.string().min(1).nullable().optional(),
        priority: z
          .enum(["lowest", "low", "medium", "high", "highest"])
          .optional(),
        points: z.number().min(0).max(10_000).nullable().optional(),
      },
      annotations: { destructiveHint: false },
    },
    async (input) =>
      write("set_work_item_attributes", () => setWorkItemAttributes(input)),
  );

  server.registerTool(
    "move_work_item",
    {
      title: "Move work item",
      description:
        "Move an item between statuses, sprints, hierarchy parents, or backlog positions. beforeId/afterId name the neighboring items.",
      inputSchema: {
        workItemId: z.string().min(1),
        statusId: z.string().min(1).optional(),
        sprintId: z.string().min(1).nullable().optional(),
        parentId: z.string().min(1).nullable().optional(),
        beforeId: z.string().min(1).nullable().optional(),
        afterId: z.string().min(1).nullable().optional(),
      },
      annotations: { destructiveHint: false },
    },
    async (input) => write("move_work_item", () => moveWorkItem(input)),
  );

  server.registerTool(
    "move_work_items",
    {
      title: "Move work item batch",
      description:
        "Move an ordered block of 2–200 work items in one backlog operation.",
      inputSchema: {
        workItemIds: z.array(z.string().min(1)).min(2).max(200),
        sprintId: z.string().min(1).nullable().optional(),
        beforeId: z.string().min(1).nullable().optional(),
        afterId: z.string().min(1).nullable().optional(),
      },
      annotations: { destructiveHint: false },
    },
    async (input) => write("move_work_items", () => moveWorkItems(input)),
  );

  server.registerTool(
    "reschedule_work_item",
    {
      title: "Reschedule work item",
      description: "Set or clear an item's start and due dates (YYYY-MM-DD).",
      inputSchema: {
        workItemId: z.string().min(1),
        startDate: z.string().nullable(),
        dueDate: z.string().nullable(),
      },
      annotations: { destructiveHint: false },
    },
    async (input) =>
      write("reschedule_work_item", () => rescheduleWorkItem(input)),
  );

  server.registerTool(
    "set_work_item_parent",
    {
      title: "Set work item parent",
      description: "Set a hierarchy parent, or null to detach the item.",
      inputSchema: {
        workItemId: z.string().min(1),
        parentId: z.string().min(1).nullable(),
      },
      annotations: { destructiveHint: false },
    },
    async (input) =>
      write("set_work_item_parent", () => setWorkItemParent(input)),
  );

  for (const [name, action, title] of [
    ["link_work_items", linkWorkItems, "Link related work items"],
    ["unlink_work_items", unlinkWorkItems, "Unlink related work items"],
  ] as const) {
    server.registerTool(
      name,
      {
        title,
        description: "Create or remove a symmetric related-work-item link.",
        inputSchema: {
          workItemId: z.string().min(1),
          relatedWorkItemId: z.string().min(1),
        },
        annotations: { destructiveHint: name === "unlink_work_items" },
      },
      async (input: unknown) =>
        write(name, () => action(input as never) as Promise<unknown>),
    );
  }

  server.registerTool(
    "delete_work_item",
    {
      title: "Delete work item",
      description: "Permanently delete a work item and its attachments.",
      inputSchema: { workItemId: z.string().min(1) },
      annotations: { destructiveHint: true },
    },
    async (input) => write("delete_work_item", () => deleteWorkItem(input)),
  );

  server.registerTool(
    "get_work_item_comments",
    {
      title: "Get work item comments",
      description:
        "Get the accessible threaded comment discussion for a work item.",
      inputSchema: { workItemId: z.string().min(1) },
    },
    async (input) => {
      try {
        return text(
          await withMcpActor(actor.userId, () =>
            getWorkItemCommentThread(input),
          ),
        );
      } catch (error) {
        Sentry.captureException(error, {
          extra: { tool: "get_work_item_comments" },
        });
        return toolError("Unable to get work item comments right now.");
      }
    },
  );

  server.registerTool(
    "get_work_item_attachments",
    {
      title: "Get work item attachments",
      description:
        "List attachments for an accessible work item, including permission-gated download links.",
      inputSchema: { workItemId: z.string().min(1) },
    },
    async (input) => {
      try {
        return text(
          await withMcpActor(actor.userId, () => getWorkItemAttachments(input)),
        );
      } catch (error) {
        Sentry.captureException(error, {
          extra: { tool: "get_work_item_attachments" },
        });
        return toolError("Unable to get work item attachments right now.");
      }
    },
  );

  server.registerTool(
    "update_work_item_attachment",
    {
      title: "Update work item attachment",
      description: "Rename an attachment or update its optional caption.",
      inputSchema: {
        attachmentId: z.string().min(1),
        fileName: z.string().trim().min(1).max(255),
        description: z.string().trim().max(2_000).nullable().optional(),
      },
      annotations: { destructiveHint: false },
    },
    async (input) =>
      write("update_work_item_attachment", () =>
        updateWorkItemAttachment(input),
      ),
  );

  server.registerTool(
    "delete_work_item_attachment",
    {
      title: "Delete work item attachment",
      description: "Permanently delete an attachment and its stored object.",
      inputSchema: { attachmentId: z.string().min(1) },
      annotations: { destructiveHint: true },
    },
    async (input) =>
      write("delete_work_item_attachment", () =>
        deleteWorkItemAttachment(input),
      ),
  );

  server.registerTool(
    "create_work_item_comment",
    {
      title: "Create work item comment",
      description:
        "Post a Markdown comment or reply at any depth to a work item.",
      inputSchema: {
        workItemId: z.string().min(1),
        body: z.string().trim().min(1).max(20_000),
        parentId: z.string().min(1).nullable().optional(),
        mentionedMemberIds: z.array(z.string().min(1)).max(100).optional(),
      },
      annotations: { destructiveHint: false },
    },
    async (input) =>
      write("create_work_item_comment", () => createWorkItemComment(input)),
  );

  server.registerTool(
    "update_work_item_comment",
    {
      title: "Update work item comment",
      description: "Edit your own work item comment in Markdown.",
      inputSchema: {
        commentId: z.string().min(1),
        body: z.string().trim().min(1).max(20_000),
        mentionedMemberIds: z.array(z.string().min(1)).max(100).optional(),
      },
      annotations: { destructiveHint: false },
    },
    async (input) =>
      write("update_work_item_comment", () => updateWorkItemComment(input)),
  );

  server.registerTool(
    "delete_work_item_comment",
    {
      title: "Delete work item comment",
      description:
        "Delete your own comment, or another person's comment when you have moderation permission.",
      inputSchema: { commentId: z.string().min(1) },
      annotations: { destructiveHint: true },
    },
    async (input) =>
      write("delete_work_item_comment", () => deleteWorkItemComment(input)),
  );

  server.registerTool(
    "toggle_work_item_comment_reaction",
    {
      title: "Toggle comment reaction",
      description:
        "Add or remove one supported reaction from a work item comment.",
      inputSchema: {
        commentId: z.string().min(1),
        emoji: z.string().min(1).max(16),
      },
      annotations: { destructiveHint: false },
    },
    async (input) =>
      write("toggle_work_item_comment_reaction", () =>
        toggleWorkItemCommentReaction(input),
      ),
  );

  const typeInput = {
    organizationId: z.string().min(1),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(2_000).optional(),
    hierarchyLevel: z.number().int().min(0),
    strictHierarchy: z.boolean().optional(),
    tone: z.enum(WORK_ITEM_TONES).optional(),
    icon: z.enum(WORK_ITEM_ICONS).optional(),
    isDefault: z.boolean().optional(),
    tracksDefect: z.boolean().optional(),
  };
  for (const [name, action, title, inputSchema, destructiveHint] of [
    [
      "create_work_item_type",
      createWorkItemType,
      "Create work item type",
      typeInput,
      false,
    ],
    [
      "update_work_item_type",
      updateWorkItemType,
      "Update work item type",
      { typeId: z.string().min(1), ...typeInput },
      false,
    ],
    [
      "delete_work_item_type",
      deleteWorkItemType,
      "Delete work item type",
      { organizationId: z.string().min(1), typeId: z.string().min(1) },
      true,
    ],
    [
      "reorder_work_item_types",
      reorderWorkItemTypes,
      "Reorder work item types",
      {
        organizationId: z.string().min(1),
        typeIds: z.array(z.string().min(1)).min(1).max(100),
      },
      false,
    ],
  ] as const) {
    server.registerTool(
      name,
      {
        title,
        description: "Manage the organization-wide work item type catalog.",
        inputSchema,
        annotations: { destructiveHint },
      },
      async (input: unknown) =>
        write(name, () => action(input as never) as Promise<unknown>),
    );
  }

  const fieldInput = {
    organizationId: z.string().min(1),
    label: z.string().trim().min(1).max(60),
    description: z.string().trim().max(2_000).optional(),
    fieldType: z.enum(WORK_ITEM_FIELD_TYPES),
    options: z
      .array(
        z.object({
          value: z.string().trim().max(60),
          label: z.string().trim().min(1).max(60),
        }),
      )
      .max(50)
      .optional(),
    appliesToTypeIds: z.array(z.string().min(1)).max(50).optional(),
    isRequired: z.boolean().optional(),
    helpText: z.string().trim().max(280).optional(),
    placement: z.enum(WORK_ITEM_FIELD_PLACEMENTS).optional(),
  };
  for (const [name, action, title, inputSchema, destructiveHint] of [
    [
      "create_work_item_field",
      createWorkItemField,
      "Create work item field",
      fieldInput,
      false,
    ],
    [
      "update_work_item_field",
      updateWorkItemField,
      "Update work item field",
      { fieldId: z.string().min(1), ...fieldInput },
      false,
    ],
    [
      "delete_work_item_field",
      deleteWorkItemField,
      "Delete work item field",
      { organizationId: z.string().min(1), fieldId: z.string().min(1) },
      true,
    ],
    [
      "reorder_work_item_fields",
      reorderWorkItemFields,
      "Reorder work item fields",
      {
        organizationId: z.string().min(1),
        fieldIds: z.array(z.string().min(1)).min(1).max(100),
      },
      false,
    ],
  ] as const) {
    server.registerTool(
      name,
      {
        title,
        description: "Manage the organization-wide custom work item fields.",
        inputSchema,
        annotations: { destructiveHint },
      },
      async (input: unknown) =>
        write(name, () => action(input as never) as Promise<unknown>),
    );
  }

  const workflowInput = {
    projectId: z.string().min(1),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(2_000).optional(),
    category: z.enum(WORKFLOW_STATUS_CATEGORIES),
    wipLimit: z.number().int().min(1).max(999).nullable().optional(),
  };
  for (const [name, action, title, inputSchema, destructiveHint] of [
    [
      "create_workflow_status",
      createWorkflowStatus,
      "Create workflow status",
      workflowInput,
      false,
    ],
    [
      "update_workflow_status",
      updateWorkflowStatus,
      "Update workflow status",
      {
        statusId: z.string().min(1),
        ...workflowInput,
        isDefault: z.boolean().optional(),
      },
      false,
    ],
    [
      "delete_workflow_status",
      deleteWorkflowStatus,
      "Delete workflow status",
      { statusId: z.string().min(1) },
      true,
    ],
    [
      "reorder_workflow_statuses",
      reorderWorkflowStatuses,
      "Reorder workflow statuses",
      {
        projectId: z.string().min(1),
        statusIds: z.array(z.string().min(1)).min(1).max(30),
      },
      false,
    ],
  ] as const) {
    server.registerTool(
      name,
      {
        title,
        description: "Manage a project's workflow statuses.",
        inputSchema,
        annotations: { destructiveHint },
      },
      async (input: unknown) =>
        write(name, () => action(input as never) as Promise<unknown>),
    );
  }

  const sprintDates = {
    startDate: z.string().min(1),
    endDate: z.string().min(1),
  };
  for (const [name, action, title, inputSchema, destructiveHint] of [
    [
      "create_sprint",
      createSprint,
      "Create sprint",
      {
        projectId: z.string().min(1),
        ...sprintDates,
        name: z.string().trim().min(1).max(120).optional(),
        goal: z.string().trim().max(2_000).optional(),
      },
      false,
    ],
    [
      "update_sprint",
      updateSprint,
      "Update sprint",
      {
        sprintId: z.string().min(1),
        ...sprintDates,
        name: z.string().trim().min(1).max(120),
        goal: z.string().trim().max(2_000).optional(),
      },
      false,
    ],
    [
      "move_sprint",
      moveSprint,
      "Move sprint",
      { sprintId: z.string().min(1), ...sprintDates },
      false,
    ],
    [
      "start_sprint",
      startSprint,
      "Start sprint",
      { sprintId: z.string().min(1) },
      false,
    ],
    [
      "complete_sprint",
      completeSprint,
      "Complete sprint",
      {
        sprintId: z.string().min(1),
        completedPoints: z.number().min(0).max(100_000).optional(),
      },
      false,
    ],
    [
      "delete_sprint",
      deleteSprint,
      "Delete sprint",
      { sprintId: z.string().min(1) },
      true,
    ],
  ] as const) {
    server.registerTool(
      name,
      {
        title,
        description: "Manage a project's sprint lifecycle.",
        inputSchema,
        annotations: { destructiveHint },
      },
      async (input: unknown) =>
        write(name, () => action(input as never) as Promise<unknown>),
    );
  }

  return server;
}
