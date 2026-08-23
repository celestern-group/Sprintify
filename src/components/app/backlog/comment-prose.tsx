"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { UserGlimpse } from "@/components/app/user-glimpse";
import type { BacklogMemberRow } from "@/lib/actions/work-items";
import { AI_MENTION_ID } from "@/lib/comment-authors";

/**
 * A rendered comment body, with its @-mentions upgraded to person hover cards.
 *
 * The body itself still arrives as server-sanitized HTML and still goes in
 * through `dangerouslySetInnerHTML` — that is the XSS boundary and it does not
 * move. What happens after mount is additive: the mention spans the markdown
 * pipeline already emits (`span[data-type=mention][data-id]`) are located in
 * the DOM and a `UserGlimpse` is PORTALLED into each one.
 *
 * Portals rather than parsing the HTML into React elements: a client-side HTML
 * parser is a dependency and a second, differently-behaved interpretation of
 * a string we sanitize precisely once. Splitting the string on mention spans
 * is worse still — a mention sits mid-paragraph, so the halves are unbalanced
 * HTML and each `dangerouslySetInnerHTML` chunk would be auto-closed into a
 * different document than the one we sanitized. Portalling leaves the parsed
 * DOM exactly as the server described it and only fills in a node's contents.
 */
export function CommentProse({
  html,
  members,
  className,
}: {
  html: string;
  /** The project's membership — the seed for a mention's hover card. */
  members: BacklogMemberRow[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mentions, setMentions] = useState<
    { id: string; label: string; node: HTMLElement }[]
  >([]);

  /*
   * `html` is never read in the body below — it is the trigger. React replaces
   * the innerHTML subtree only when `html` changes, so that is exactly when the
   * mention spans have to be re-located.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `html` is a re-run trigger, not a read
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const found: { id: string; label: string; node: HTMLElement }[] = [];
    const nodes = root.querySelectorAll<HTMLElement>('[data-type="mention"]');

    for (const node of nodes) {
      const id = node.dataset.id ?? "";
      // The assistant is a sentinel, not a member — there is no person to
      // preview, and asking the server about it would always miss.
      if (!id || id === AI_MENTION_ID) continue;

      const label = node.dataset.label ?? node.textContent?.replace(/^@/, "");
      if (!label) continue;

      // The portal supplies the label from here on; leaving the original text
      // in place would render it twice. Safe to mutate: this subtree came from
      // innerHTML, so React holds no vdom for it and only ever replaces it
      // wholesale when `html` itself changes — which re-runs this effect.
      node.textContent = "";
      found.push({ id, label, node });
    }

    setMentions(found);
  }, [html]);

  return (
    <>
      <div
        className={className}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered + sanitized markdown
        dangerouslySetInnerHTML={{ __html: html }}
        ref={containerRef}
      />
      {mentions.map((mention, index) => {
        const member = members.find((row) => row.memberId === mention.id);
        return createPortal(
          <UserGlimpse
            // Hover only, deliberately: a mention sits inline in a sentence,
            // and a focusable button there both interrupts the text flow and
            // puts a tab stop in the middle of a paragraph.
            interactive={false}
            seed={{
              memberId: mention.id,
              name: member?.name ?? mention.label,
              email: member?.email,
              image: member?.image,
            }}
          >
            @{mention.label}
          </UserGlimpse>,
          mention.node,
          `${mention.id}-${index}`,
        );
      })}
    </>
  );
}
