-- Added nullable first, then backfilled, then tightened: existing rows have no
-- key and NOT NULL cannot be added in one step. The derivation mirrors
-- deriveProjectKey() in src/lib/project-key.ts — initials for multi-word names,
-- the word itself for single-word names, 'P' prefixed when it would start with
-- a digit, 'PROJ' as the fallback — with a numeric suffix on collision so the
-- unique index below can be created.
ALTER TABLE "project" ADD COLUMN "key" text;--> statement-breakpoint
WITH words AS (
  SELECT
    id,
    "organizationId",
    "createdAt",
    ARRAY(
      SELECT part
      FROM regexp_split_to_table(upper(name), '[^A-Z0-9]+') AS part
      WHERE part <> ''
    ) AS parts
  FROM "project"
),
derived AS (
  SELECT
    id,
    "organizationId",
    "createdAt",
    CASE
      WHEN coalesce(array_length(parts, 1), 0) = 0 THEN 'PROJ'
      WHEN array_length(parts, 1) > 1
        THEN array_to_string(ARRAY(SELECT left(part, 1) FROM unnest(parts) AS part), '')
      ELSE parts[1]
    END AS raw
  FROM words
),
based AS (
  SELECT
    id,
    "organizationId",
    "createdAt",
    CASE WHEN length(candidate) >= 2 THEN candidate ELSE 'PROJ' END AS base
  FROM (
    SELECT
      id,
      "organizationId",
      "createdAt",
      left(CASE WHEN raw ~ '^[0-9]' THEN 'P' || raw ELSE raw END, 10) AS candidate
    FROM derived
  ) AS prefixed
),
numbered AS (
  SELECT
    id,
    base,
    row_number() OVER (
      PARTITION BY "organizationId", base ORDER BY "createdAt", id
    ) AS occurrence
  FROM based
)
UPDATE "project" AS p
SET "key" = CASE
  WHEN n.occurrence = 1 THEN n.base
  ELSE left(n.base, 10 - length(n.occurrence::text)) || n.occurrence::text
END
FROM numbered AS n
WHERE p.id = n.id;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_organizationId_key_uidx" ON "project" USING btree ("organizationId","key");
