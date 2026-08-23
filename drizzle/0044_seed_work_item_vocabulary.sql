-- Seed the backlog layer for everything that already exists: the work item
-- vocabulary for every organization, and the board's columns for every project.
--
-- New organizations get the types from the afterCreateOrganization hook and new
-- projects get the statuses from createProject; both derive from
-- SEED_WORK_ITEM_TYPES / SEED_WORKFLOW_STATUSES in src/lib/work-items.ts, so
-- keep them in sync if the starting catalog ever changes.
--
-- Same shape as 0019_seed_project_roles.sql: CROSS JOIN covers every row
-- without knowing their ids, and an untargeted ON CONFLICT DO NOTHING (partial
-- unique indexes are awkward to name as inference targets) makes it re-runnable.
INSERT INTO "workItemType" ("id", "organizationId", "key", "name", "description", "hierarchyLevel", "tone", "icon", "isDefault", "position", "source", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", v.key, v.name, v.description, v.level, v.tone, v.icon, v.is_default, v.position, 'local', now(), now()
FROM "organization" o
CROSS JOIN (VALUES
  ('epic', 'Epic', 'A large body of work that spans sprints and holds stories.', 2, 'brand', 'IconBolt', false, 0),
  ('story', 'Story', 'A user-facing change, described from the user''s point of view.', 1, 'success', 'IconBookmark', true, 1),
  ('task', 'Task', 'A piece of work that isn''t expressed as a user story.', 1, 'blue', 'IconCheckbox', false, 2),
  ('bug', 'Bug', 'Something behaving differently from how it should.', 1, 'danger', 'IconBug', false, 3),
  ('subtask', 'Sub-task', 'A slice of a story or task, tracked under its parent.', 0, 'neutral', 'IconSubtask', false, 4)
) AS v(key, name, description, level, tone, icon, is_default, position)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "workflowStatus" ("id", "organizationId", "projectId", "name", "description", "category", "position", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid(), p."organizationId", p."id", v.name, v.description, v.category, v.position, v.is_default, now(), now()
FROM "project" p
CROSS JOIN (VALUES
  ('To do', 'Accepted into the sprint, not started.', 'todo', 0, true),
  ('In progress', 'Someone is actively working on it.', 'in_progress', 1, false),
  ('In review', 'Work is done and waiting on review.', 'in_progress', 2, false),
  ('Done', 'Finished and accepted.', 'done', 3, false)
) AS v(name, description, category, position, is_default)
ON CONFLICT DO NOTHING;
