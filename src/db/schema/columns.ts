import { customType } from "drizzle-orm/pg-core";

/**
 * A pgvector column with no fixed width. Organizations pin their own
 * embedding model (src/lib/ai/), and different models emit different
 * dimensions (1536, 1024, ...), so a single vector(N) column can't hold every
 * org's vectors — Postgres rejects an insert whose length doesn't match a
 * fixed typmod. Leaving the dimension unspecified accepts any length, at the
 * cost of no ivfflat/HNSW index: callers must filter to rows sharing the same
 * `embeddingModel` before comparing vectors with `<=>`, since pgvector errors
 * on mismatched dimensions at query time too.
 */
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return value.slice(1, -1).split(",").filter(Boolean).map(Number);
  },
});
