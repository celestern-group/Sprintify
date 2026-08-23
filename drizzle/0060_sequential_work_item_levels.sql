-- Each seeded work-item type has its own ascending numeric level. Keep the
-- values aligned with SEED_WORK_ITEM_TYPES; custom types retain their chosen
-- level.
UPDATE "workItemType"
SET "hierarchyLevel" = CASE "key"
  WHEN 'epic' THEN 0
  WHEN 'feature' THEN 1
  WHEN 'story' THEN 2
  WHEN 'task' THEN 3
  WHEN 'bug' THEN 4
  WHEN 'subtask' THEN 5
  ELSE "hierarchyLevel"
END,
"updatedAt" = now()
WHERE "key" IN ('epic', 'feature', 'story', 'task', 'bug', 'subtask');
