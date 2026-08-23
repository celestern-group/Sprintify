import "server-only";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { project, workflowStatus, workItem } from "@/db/schema";
import { workItemKey } from "@/lib/work-items";
import { embedText } from "./embeddings";

/**
 * Meaning-based lookup over the work item embeddings that create/update already
 * write. Everything here is a read of vectors that exist — no extra model call
 * beyond embedding the one query string.
 *
 * The `embeddingModel` filter is not an optimisation, it is a correctness
 * requirement: the column is a dimension-less pgvector (see
 * src/db/schema/columns.ts), so comparing a 1536-wide query against a 1024-wide
 * row is a Postgres ERROR, not a bad score.
 */

export type SimilarWorkItem = {
  id: string;
  key: string;
  number: number;
  summary: string;
  typeId: string;
  statusId: string;
  statusCategory: "todo" | "in_progress" | "done";
  points: number | null;
  /** Cosine similarity in 0..1 — 1 is identical. */
  similarity: number;
};

/**
 * Cosine similarity above which two items are worth showing side by side.
 * Deliberately low: this powers a "have a look at these" prompt, never an
 * automatic merge, and a missed duplicate costs more than a dismissed row.
 */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.78;

export type SimilarityQuery = {
  organizationId: string;
  projectId: string;
  /** Free text — a query, or an item's own summary + description. */
  text: string;
  /** Never suggest the item you are looking at as its own neighbour. */
  excludeWorkItemId?: string | null;
  limit?: number;
  minSimilarity?: number;
  /** Restrict to finished work — what an estimate should be based on. */
  completedOnly?: boolean;
};

/**
 * Returns null (not an empty array) when the organization has no usable
 * embedding configuration — "we couldn't look" and "we looked and found
 * nothing" are different answers, and the UI says so.
 */
export async function findSimilarWorkItems(
  input: SimilarityQuery,
): Promise<SimilarWorkItem[] | null> {
  const embedded = await embedText(input.organizationId, input.text);
  if (!embedded) return null;

  // A bound parameter cast to vector: interpolating the numbers into the SQL
  // string would be an injection surface for anything that ever reaches this
  // path from user input.
  const target = sql`${JSON.stringify(embedded.embedding)}::vector`;
  const distance = sql<number>`${workItem.embedding} <=> ${target}`;

  const rows = await db
    .select({
      id: workItem.id,
      number: workItem.number,
      projectKey: project.key,
      summary: workItem.summary,
      typeId: workItem.typeId,
      statusId: workItem.statusId,
      statusCategory: workflowStatus.category,
      points: workItem.points,
      distance,
    })
    .from(workItem)
    .innerJoin(project, eq(workItem.projectId, project.id))
    .innerJoin(workflowStatus, eq(workItem.statusId, workflowStatus.id))
    .where(
      and(
        eq(workItem.projectId, input.projectId),
        isNotNull(workItem.embedding),
        eq(workItem.embeddingModel, embedded.model),
        input.excludeWorkItemId
          ? ne(workItem.id, input.excludeWorkItemId)
          : undefined,
        input.completedOnly ? isNotNull(workItem.completedAt) : undefined,
      ),
    )
    .orderBy(distance)
    .limit(input.limit ?? 5);

  const floor = input.minSimilarity ?? 0;
  return rows
    .map((row) => ({
      id: row.id,
      key: workItemKey(row.projectKey, row.number),
      number: row.number,
      summary: row.summary,
      typeId: row.typeId,
      statusId: row.statusId,
      statusCategory: row.statusCategory,
      points: row.points,
      similarity: 1 - Number(row.distance),
    }))
    .filter((row) => row.similarity >= floor);
}

export type EstimateSuggestion = {
  /** The median of the neighbours' estimates, rounded to a half. */
  points: number;
  /** What the number was read off — shown so nobody has to trust it blind. */
  basis: SimilarWorkItem[];
};
