"use client";

import { IconBell } from "@tabler/icons-react";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useReturnToHref } from "@/hooks/use-return-to";
import {
  type BellData,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from "@/lib/actions/notifications";
import { withReturnTo } from "@/lib/return-to";
import { cn } from "@/lib/utils";

/**
 * The topbar bell: unread count on the trigger, the recent list in a popover.
 * Data arrives server-fetched from the layout (no client cache — it refreshes
 * with navigation, like every other read in the app); the mark-read actions
 * revalidate the layout so the badge follows.
 */
export function NotificationBell({
  organizationId,
  orgSlug,
  initial,
}: {
  organizationId: string;
  orgSlug: string;
  initial: BellData;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const unread = initial.unreadCount;
  // The bell interrupts whatever screen you were on, so it hands that screen
  // over as the way back — a mention read from the sprint board returns to the
  // sprint board rather than dumping the reader in the backlog.
  const returnTo = useReturnToHref();

  function openNotification(row: NotificationRow) {
    setOpen(false);
    startTransition(async () => {
      if (!row.readAt) {
        await markNotificationRead({ organizationId, notificationId: row.id });
      }
      const href = notificationHref(row, orgSlug);
      if (href) router.push(withReturnTo(href, returnTo));
      else router.refresh();
    });
  }

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsRead({ organizationId });
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              unread > 0 ? `Notifications (${unread} unread)` : "Notifications"
            }
          >
            <IconBell />
            {unread > 0 ? (
              <span
                aria-hidden
                className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-primary-foreground"
              >
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-88 max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={markAll}
            >
              Mark all read
            </Button>
          ) : null}
        </div>
        {initial.notifications.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            You're all caught up — assignments and status changes land here.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {initial.notifications.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => openNotification(row)}
                  className={cn(
                    "flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                    !row.readAt && "bg-secondary/50",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      row.readAt ? "bg-transparent" : "bg-primary",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-foreground">
                      {describeNotification(row)}
                    </span>
                    <time
                      dateTime={row.createdAt.toISOString()}
                      className="block text-xs text-muted-foreground"
                    >
                      {formatDistanceToNow(row.createdAt, { addSuffix: true })}
                    </time>
                  </span>
                  {!row.readAt ? (
                    <span className="sr-only">Unread.</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function meta(row: NotificationRow, field: string): string | null {
  const value = row.metadata?.[field];
  return typeof value === "string" && value ? value : null;
}

/** One human sentence per action; the vocabulary mirrors auditLog.action. */
function describeNotification(row: NotificationRow): string {
  const actor = row.actorName ?? row.actorEmail ?? "Someone";
  const key = meta(row, "key");
  const summary = meta(row, "summary");
  const item = key ? `${key}${summary ? ` — ${summary}` : ""}` : "a work item";
  switch (row.action) {
    case "workItem.assigned":
      return `${actor} assigned ${item} to you`;
    case "workItem.status_changed": {
      const toStatus = meta(row, "toStatus");
      return `${actor} moved ${item}${toStatus ? ` to ${toStatus}` : ""}`;
    }
    case "workItem.deleted":
      return `${actor} deleted ${item}`;
    case "workItem.mentioned": {
      const preview = meta(row, "preview");
      return `${actor} mentioned you on ${item}${preview ? `: "${preview}"` : ""}`;
    }
    case "workItem.commented": {
      const preview = meta(row, "preview");
      return `${actor} commented on ${item}${preview ? `: "${preview}"` : ""}`;
    }
    case "workItem.attached": {
      const fileName = meta(row, "fileName");
      const count = Number(row.metadata?.count ?? 1);
      if (count > 1) return `${actor} attached ${count} files to ${item}`;
      return `${actor} attached ${fileName ?? "a file"} to ${item}`;
    }
    case "sprint.started":
      return `${actor} started sprint ${meta(row, "name") ?? ""}`.trim();
    case "sprint.completed":
      return `${actor} completed sprint ${meta(row, "name") ?? ""}`.trim();
    case "member.added":
      return `${actor} added you to ${meta(row, "projectName") ?? "a project"}`;
    case "idea.review_requested":
      return `${actor} asked you to evaluate ${meta(row, "title") ?? "an idea"}`;
    case "idea.commented": {
      const preview = meta(row, "preview");
      return `${actor} commented on ${meta(row, "title") ?? "an idea"}${preview ? `: "${preview}"` : ""}`;
    }
    default:
      return `${actor} did something (${row.action})`;
  }
}

/** Deep link for the row, when its target still has a page to land on. */
function notificationHref(
  row: NotificationRow,
  orgSlug: string,
): string | null {
  const projectKey = meta(row, "projectKey");
  if (!projectKey) return null;
  const base = `/app/${orgSlug}/${projectKey}`;
  switch (row.action) {
    case "workItem.assigned":
    case "workItem.status_changed":
    case "workItem.mentioned":
    case "workItem.commented":
    case "workItem.attached": {
      const key = meta(row, "key");
      return key ? `${base}/backlog/${key}` : base;
    }
    case "sprint.started":
    case "sprint.completed":
      return row.targetId ? `${base}/sprints/${row.targetId}` : base;
    case "member.added":
      return base;
    case "idea.review_requested": {
      const ideaId = meta(row, "ideaId");
      return ideaId ? `${base}/ideas/${ideaId}` : `${base}/ideas`;
    }
    case "idea.commented": {
      const ideaId = meta(row, "ideaId");
      return ideaId ? `${base}/ideas/${ideaId}` : `${base}/ideas`;
    }
    default:
      return null;
  }
}
