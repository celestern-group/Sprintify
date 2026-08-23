"use client";

import { IconSparkles } from "@tabler/icons-react";
import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";
import Fuse from "fuse.js";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { BacklogMemberRow } from "@/lib/actions/work-items";
import { AI_AUTHOR_NAME, AI_MENTION_ID } from "@/lib/comment-authors";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/work-items";

// The @-mention node and its menu, shared by the comment composer and the work
// item's prose fields.
//
// One module because the two surfaces must agree on the STORED form, not just
// on how the menu looks: a mention typed in a description and a mention typed
// in a comment have to serialize to the same span, or src/lib/mentions.ts
// reads one of them and not the other, and someone silently never gets paged.
//
// Storage stays MARKDOWN everywhere. A mention is the one node with no
// markdown syntax, so it round-trips as an inline HTML span — the same route
// tables, task lists and underline already take through `html: true`. That span
// is re-parsed back into a mention node on edit, and rendered (after
// sanitizing) by src/lib/markdown.ts for display.

/** Matches the design-system chip: neutral surface, violet ink, never a fill. */
export const MENTION_CLASS =
  "rounded-[8px] bg-chip px-1 py-0.5 font-semibold text-brand";

/**
 * The chip again, as a descendant selector, for surfaces that render STORED
 * markdown rather than a live editor — a comment body has no React component
 * to hang MENTION_CLASS off, only the span. Written out rather than
 * interpolated so Tailwind can see the class names in source.
 */
export const MENTION_PROSE_CLASS =
  "[&_span[data-type=mention]]:rounded-[8px] [&_span[data-type=mention]]:bg-chip [&_span[data-type=mention]]:px-1 [&_span[data-type=mention]]:py-0.5 [&_span[data-type=mention]]:font-semibold [&_span[data-type=mention]]:text-brand";

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The mention's markdown form, declared rather than left to tiptap-markdown's
 * generic HTML fallback: the fallback serializes an inline node by rendering
 * its whole parent, which loses the surrounding text. Parsing needs no
 * counterpart — markdown-it passes the raw span through and the node's own
 * `parseHTML` (span[data-type="mention"]) picks it up.
 *
 * The attribute ORDER here is part of the contract with src/lib/mentions.ts;
 * that parser is order-independent, but keep them together anyway so a stored
 * span stays readable in a database dump.
 */
export const MentionNode = Mention.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (text: string) => void },
          node: { attrs: { id?: string | null; label?: string | null } },
        ) {
          const id = String(node.attrs.id ?? "");
          const label = String(node.attrs.label ?? id);
          state.write(
            `<span data-type="mention" data-id="${escapeAttribute(id)}" data-label="${escapeAttribute(label)}">@${escapeAttribute(label)}</span>`,
          );
        },
        parse: {},
      },
    };
  },
});

/**
 * The assistant as a mention candidate. Not a member row and never stored as
 * one — `memberId` carries the sentinel the create action looks for, and the
 * suggestion list is the only place the two shapes meet.
 */
export const AI_CANDIDATE: BacklogMemberRow = {
  memberId: AI_MENTION_ID,
  name: AI_AUTHOR_NAME,
  email: "",
  image: null,
};

type MentionListHandle = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

type MentionListProps = SuggestionProps<BacklogMemberRow>;

/**
 * The @-menu. Keyboard handling lives here rather than going through the slash
 * menu's global `#slash-command` lookup — two suggestion menus answering the
 * same document query is exactly the kind of coupling that breaks when one of
 * them changes.
 */
const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);

    // A new query is a new list; keeping the old index would highlight
    // whatever happens to sit in that slot now.
    // biome-ignore lint/correctness/useExhaustiveDependencies: resetting ON the new list is the point
    useEffect(() => {
      setSelected(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelected((current) =>
            items.length === 0
              ? 0
              : (current + items.length - 1) % items.length,
          );
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((current) =>
            items.length === 0 ? 0 : (current + 1) % items.length,
          );
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const item = items[selected];
          if (!item) return false;
          command({ id: item.memberId, label: item.name });
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="rounded-[11px] border border-border bg-popover p-3 text-sm text-muted-foreground shadow-pop">
          No one on this project matches.
        </div>
      );
    }

    return (
      <div className="max-h-64 w-64 overflow-y-auto rounded-[11px] border border-border bg-popover p-1 shadow-pop">
        {items.map((item, index) => (
          <button
            className={cn(
              "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-sm",
              index === selected
                ? "bg-secondary text-secondary-foreground"
                : "text-foreground",
            )}
            key={item.memberId}
            onClick={() => command({ id: item.memberId, label: item.name })}
            // Mouse hover moves the selection so the keyboard and the pointer
            // never disagree about what Enter would pick.
            onMouseEnter={() => setSelected(index)}
            type="button"
          >
            {item.memberId === AI_MENTION_ID ? (
              // A glyph, not initials: the assistant is not a person and must
              // not sit in the list wearing a person's avatar shape.
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-chip text-brand">
                <IconSparkles className="size-3.5" aria-hidden />
              </span>
            ) : (
              <Avatar size="sm">
                {item.image ? <AvatarImage alt="" src={item.image} /> : null}
                <AvatarFallback>{initialsOf(item.name)}</AvatarFallback>
              </Avatar>
            )}
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            {item.memberId === AI_MENTION_ID ? (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                Assistant
              </span>
            ) : null}
          </button>
        ))}
      </div>
    );
  },
);
MentionList.displayName = "MentionList";

/**
 * The suggestion config for the mention node.
 *
 * `candidates` is a THUNK, read on every query: the extension is built once per
 * editor, and a captured array would go stale the moment the project's
 * membership loaded or changed.
 */
export function mentionSuggestion(candidates: () => BacklogMemberRow[]) {
  return {
    char: "@",
    // The list is small and already in memory (the page loads the project's
    // membership for its pickers), so matching is local — no request per
    // keystroke, and the menu opens instantly.
    items: ({ query }: { query: string }) => {
      const all = candidates();
      if (!query) return all.slice(0, 8);
      const fuse = new Fuse(all, {
        keys: ["name", "email"],
        threshold: 0.3,
        minMatchCharLength: 1,
      });
      return fuse
        .search(query)
        .slice(0, 8)
        .map((result) => result.item);
    },
    render: () => {
      let component: ReactRenderer<MentionListHandle, MentionListProps> | null =
        null;
      let popup: TippyInstance | null = null;

      return {
        onStart: (props: MentionListProps) => {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          });
          popup = tippy(document.body, {
            getReferenceClientRect: () => props.clientRect?.() || new DOMRect(),
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          });
        },
        onUpdate: (props: MentionListProps) => {
          component?.updateProps(props);
          popup?.setProps({
            getReferenceClientRect: () => props.clientRect?.() || new DOMRect(),
          });
        },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === "Escape") {
            popup?.hide();
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          popup?.destroy();
          component?.destroy();
          popup = null;
          component = null;
        },
      };
    },
  };
}

/** The configured node, ready to drop into an editor's extension list. */
export function mentionExtension(candidates: () => BacklogMemberRow[]) {
  return MentionNode.configure({
    HTMLAttributes: { class: MENTION_CLASS },
    deleteTriggerWithBackspace: true,
    suggestion: mentionSuggestion(candidates),
  });
}
