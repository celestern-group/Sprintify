"use client";

import { IconHistory, IconMessage, IconPaperclip } from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { ItemAttachments } from "@/components/app/backlog/item-attachments";
import { ItemComments } from "@/components/app/backlog/item-comments";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WorkItemCommentThread } from "@/lib/actions/work-item-comments";
import type { BacklogMemberRow } from "@/lib/actions/work-items";
import type { WorkItemAttachmentPayload } from "@/lib/work-item-attachments";

/**
 * The item's activity panel: the discussion first, then its files, then the
 * audit trail.
 *
 * Comments lead because they are the only half anyone acts on — history
 * answers "what happened", comments are where the work is negotiated, and
 * attachments sit between the two: evidence, referenced by both. The history
 * tab is passed in as a rendered node rather than imported, so it stays a
 * server component: it resolves ids to names against catalogs this client
 * boundary has no reason to hold.
 */
export function ItemActivity({
  workItemId,
  thread,
  members,
  history,
  attachments,
}: {
  workItemId: string;
  thread: WorkItemCommentThread;
  members: BacklogMemberRow[];
  /** <ItemHistory />, rendered on the server. */
  history: React.ReactNode;
  attachments: WorkItemAttachmentPayload;
}) {
  const [count, setCount] = useState(thread.totalCount);
  const [fileCount, setFileCount] = useState(attachments.attachments.length);
  // Stable so the tab's effect doesn't re-run on every render of this panel.
  const handleFileCount = useCallback((next: number) => {
    setFileCount(next);
  }, []);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-card">
      <Tabs defaultValue="comments">
        <TabsList>
          <TabsTrigger value="comments">
            <IconMessage className="size-4" aria-hidden />
            Comments
            {count > 0 ? (
              <span className="ml-1.5 tabular-nums text-muted-foreground">
                {count}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="attachments">
            <IconPaperclip className="size-4" aria-hidden />
            Attachments
            {fileCount > 0 ? (
              <span className="ml-1.5 tabular-nums text-muted-foreground">
                {fileCount}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="history">
            <IconHistory className="size-4" aria-hidden />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent className="pt-4" value="comments">
          <ItemComments
            initial={thread}
            members={members}
            onCountChange={setCount}
            workItemId={workItemId}
          />
        </TabsContent>
        <TabsContent className="pt-4" value="attachments">
          <ItemAttachments
            initial={attachments}
            onCountChange={handleFileCount}
          />
        </TabsContent>
        <TabsContent className="pt-4" value="history">
          {history}
        </TabsContent>
      </Tabs>
    </section>
  );
}
