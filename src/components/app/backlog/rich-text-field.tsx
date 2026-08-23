"use client";

import type { Editor, EditorEvents } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";
import { useEffect, useId, useRef } from "react";
import { Markdown } from "tiptap-markdown";
import { AiAssistMenu } from "@/components/app/backlog/ai-assist-menu";
import {
  AttachmentDropzone,
  type AttachmentUploader,
} from "@/components/app/backlog/attachment-dropzone";
import {
  attachmentImageExtension,
  createImagePasteHandler,
  IMAGE_PROSE_CLASS,
  insertAttachmentContent,
} from "@/components/app/backlog/editor-images";
import { EditorToolbar } from "@/components/app/backlog/editor-toolbar";
import {
  MENTION_PROSE_CLASS,
  mentionExtension,
} from "@/components/app/backlog/mention-extension";
import {
  EditorProvider,
  EditorTableColumnAfter,
  EditorTableColumnBefore,
  EditorTableColumnDelete,
  EditorTableColumnMenu,
  EditorTableDelete,
  EditorTableFix,
  EditorTableGlobalMenu,
  EditorTableHeaderColumnToggle,
  EditorTableHeaderRowToggle,
  EditorTableMenu,
  EditorTableMergeCells,
  EditorTableRowAfter,
  EditorTableRowBefore,
  EditorTableRowDelete,
  EditorTableRowMenu,
  EditorTableSplitCell,
} from "@/components/kibo-ui/editor";
import { Field, FieldDescription } from "@/components/ui/field";
import type { BacklogMemberRow } from "@/lib/actions/work-items";
import { cn } from "@/lib/utils";
import type { WorkItemAttachmentRow } from "@/lib/work-item-attachments";

/**
 * Markdown is the stored form — see WORK_ITEM_PROSE_LIMIT in the item form and
 * `workItemDescriptionSchema`. `html: true` matters: the editor can produce
 * nodes plain CommonMark has no syntax for (tables, task lists, underline,
 * sub/superscript), and without the HTML fallback those either throw on
 * serialize or silently flatten to their text.
 *
 * `breaks: true` is what keeps the pre-editor rows readable — everything
 * written into the old textareas used single newlines ("Given …\nWhen …\nThen
 * …"), which strict markdown folds into one paragraph.
 */
const markdownExtension = Markdown.configure({
  html: true,
  breaks: true,
  transformPastedText: true,
  transformCopiedText: true,
});

/**
 * ProseMirror renders bare tags, and the project has no typography plugin, so
 * the document's own hierarchy is styled here. Kept as one string because every
 * prose field must read identically — a heading in Description and a heading in
 * Acceptance criteria are the same heading.
 */
const proseStyles = cn(
  // The padding sits on the document, not on the box: the toolbar renders as
  // the box's first row, and a padded box would inset the bar and stop its
  // divider reaching the edges.
  "[&_.ProseMirror]:min-h-[inherit] [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2 [&_.ProseMirror]:outline-none",
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:font-bold [&_h1]:text-xl first:[&_h1]:mt-0",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-lg first:[&_h2]:mt-0",
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_h3]:text-base first:[&_h3]:mt-0",
  "[&_p]:my-1.5 [&_p]:leading-relaxed",
  "[&_ul]:my-1.5 [&_ul]:list-outside [&_ul]:list-disc [&_ul]:pl-4",
  "[&_ol]:my-1.5 [&_ol]:list-outside [&_ol]:list-decimal [&_ol]:pl-4",
  // TaskList is an unstyled semantic <ul>, unlike the two lists above. Reset
  // its browser padding so its checkbox and text share the editor's list grid.
  "[&_ul[data-type='taskList']]:my-1.5 [&_ul[data-type='taskList']]:list-none [&_ul[data-type='taskList']]:p-0 [&_ul[data-type='taskList']_li]:m-0 [&_ul[data-type='taskList']_li>label]:mt-0.5 [&_ul[data-type='taskList']_li>div]:min-w-0 [&_ul[data-type='taskList']_li>div>p]:my-0",
  "[&_blockquote]:my-2 [&_blockquote]:border-border [&_blockquote]:text-muted-foreground",
  "[&_pre]:my-2 [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2",
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse",
  "[&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left [&_th]:font-semibold",
  MENTION_PROSE_CLASS,
  IMAGE_PROSE_CLASS,
);

/**
 * Hands the live editor instance back to the field. Applying an AI suggestion
 * has to go through the editor rather than through `value` — the document is
 * uncontrolled, so setting state alone would leave what's on screen unchanged.
 */
function EditorHandle({
  editorRef,
}: {
  editorRef: { current: Editor | null };
}) {
  const { editor } = useCurrentEditor();

  useEffect(() => {
    editorRef.current = editor ?? null;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  return null;
}

export function RichTextField({
  id,
  label,
  icon,
  value,
  onChange,
  disabled,
  placeholder,
  description,
  required,
  minHeight = "min-h-32",
  assist,
  members,
  attach,
}: {
  id: string;
  label: string;
  /** A coloured mark for the label row — decorative, so it stays aria-hidden. */
  icon?: React.ReactNode;
  /** Markdown. */
  value: string;
  /** Receives markdown. */
  onChange: (markdown: string) => void;
  disabled?: boolean;
  placeholder?: string;
  description?: string;
  required?: boolean;
  /** A Tailwind min-height class — how much room the block asks for at rest. */
  minHeight?: string;
  /** Absent = no AI control on this field. */
  assist?: {
    projectId: string;
    workItemId?: string | null;
    /** The item as the form has it right now — captions the prompt. */
    context?: { summary?: string; typeName?: string };
  };
  /**
   * Everyone @-mentionable here: the project's membership. Absent = no mention
   * menu, which is what the org-level field editors want — a work item type's
   * description has no project, so it has nobody to mention.
   *
   * The assistant is deliberately NOT offered here. @Sprintify AI answers by
   * posting a comment, and a description is not a conversation it can reply to.
   */
  members?: BacklogMemberRow[];
  /**
   * Makes this block a drop AND paste target: a file dropped on it — or an image
   * pasted into it — is attached to the item and FILED under this field, then
   * written at the caret (a picture inline, anything else as a link). Absent =
   * no attach handling, which is what the org-level field editors want (a work
   * item type's description has no item to attach to).
   */
  attach?: {
    fieldKey: string;
    fieldLabel: string;
    uploader: AttachmentUploader;
  };
}) {
  const labelId = useId();
  const editorRef = useRef<Editor | null>(null);
  // The editor owns its document once mounted: feeding `value` back in on every
  // keystroke would rebuild the doc under the caret. It's seeded once, exactly
  // like an uncontrolled input's defaultValue.
  const initialContent = useRef(value);
  // Read through a ref so the suggestion closure — created once, with the
  // extension — always sees the current membership.
  const membersRef = useRef<BacklogMemberRow[]>([]);
  membersRef.current = members ?? [];
  // The image node is unconditional: a field with no `attach` can't create one,
  // but it still has to RENDER one a saved document already carries (the same
  // description opens read-only elsewhere, and a missing node would drop the
  // picture from the markdown on the next save).
  const extensions = useRef(
    members
      ? [
          markdownExtension,
          attachmentImageExtension,
          mentionExtension(() => membersRef.current),
        ]
      : [markdownExtension, attachmentImageExtension],
  );

  function handleUpdate({ editor }: EditorEvents["update"]) {
    const markdown = editor.storage.markdown.getMarkdown();
    // An empty document serialises to "" already, but a lone empty paragraph
    // (what you get after clearing text) comes back as whitespace — the form
    // treats blank as "unset", so normalise before it ever reaches state.
    onChange(markdown.trim() === "" ? "" : markdown);
  }

  /**
   * An accepted suggestion is applied to the document, not just to state:
   * `initialContent` seeded the editor once, so state alone would desync the
   * two. Appending keeps a blank line between the old text and the new so two
   * markdown blocks don't merge into one paragraph.
   */
  function applyAssist(markdown: string, mode: "replace" | "append") {
    const next =
      mode === "replace" || value.trim() === ""
        ? markdown
        : `${value.trim()}\n\n${markdown}`;
    editorRef.current?.commands.setContent(next);
    onChange(next);
  }

  /** Images inline, everything else as a link — see insertAttachmentContent. */
  function insertAttachments(rows: WorkItemAttachmentRow[]) {
    insertAttachmentContent(editorRef.current, rows);
  }

  const editorBox = (
    <div
      className={cn(
        // Transparent, not bg-background: --background is the CANVAS grey,
        // and these editors sit inside a white card — a canvas-coloured box
        // on a card reads as disabled. Same treatment as Input: the surface
        // shows through, a hairline draws the edge.
        "rounded-[11px] border border-input bg-transparent transition-shadow",
        "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40",
        disabled && "opacity-50",
      )}
    >
      <EditorProvider
        autofocus={false}
        className={cn("w-full text-sm", minHeight, proseStyles)}
        content={initialContent.current}
        editable={!disabled}
        editorProps={{
          attributes: {
            "aria-labelledby": labelId,
            "aria-multiline": "true",
            role: "textbox",
            ...(description || !disabled
              ? { "aria-describedby": `${id}-hint` }
              : {}),
            ...(disabled ? { "aria-readonly": "true" } : {}),
          },
          // A pasted screenshot becomes an attachment on this field and an
          // inline picture at the caret. Only wired where drops are — the two
          // gestures mean the same thing and neither exists without an item to
          // attach to.
          ...(attach && !disabled
            ? {
                handlePaste: createImagePasteHandler({
                  fieldKey: attach.fieldKey,
                  uploader: attach.uploader,
                  editorRef,
                }),
              }
            : {}),
        }}
        extensions={extensions.current}
        immediatelyRender={false}
        onUpdate={handleUpdate}
        placeholder={placeholder}
        // A persistent bar rather than a bubble/floating menu: formatting a
        // prose field shouldn't have to be discovered by hovering. It goes
        // through `slotBefore` because that is the only child slot the
        // provider renders ABOVE the document, and it has to be inside the
        // provider to read the live editor. The AI control rides the same
        // bar — one row of tools for the text below it, not two.
        slotBefore={
          disabled ? null : (
            <EditorToolbar
              attach={
                attach
                  ? {
                      busy: attach.uploader.isUploading(attach.fieldKey),
                      onFiles: (files) => {
                        void attach.uploader
                          .upload(files, attach.fieldKey)
                          .then(insertAttachments);
                      },
                    }
                  : undefined
              }
            >
              {assist ? (
                <AiAssistMenu
                  context={assist.context}
                  fieldLabel={label}
                  onApply={applyAssist}
                  projectId={assist.projectId}
                  targetNoun={label}
                  value={value}
                  workItemId={assist.workItemId}
                />
              ) : null}
            </EditorToolbar>
          )
        }
      >
        <EditorHandle editorRef={editorRef} />
        {disabled ? null : (
          <>
            {/* Table controls stay contextual — they only mean anything
                  with the caret inside a table, so they can't live on a bar
                  that's always on screen. */}
            <EditorTableMenu>
              <EditorTableColumnMenu>
                <EditorTableColumnBefore />
                <EditorTableColumnAfter />
                <EditorTableColumnDelete />
              </EditorTableColumnMenu>
              <EditorTableRowMenu>
                <EditorTableRowBefore />
                <EditorTableRowAfter />
                <EditorTableRowDelete />
              </EditorTableRowMenu>
              <EditorTableGlobalMenu>
                <EditorTableHeaderColumnToggle />
                <EditorTableHeaderRowToggle />
                <EditorTableDelete />
                <EditorTableMergeCells />
                <EditorTableSplitCell />
                <EditorTableFix />
              </EditorTableGlobalMenu>
            </EditorTableMenu>
          </>
        )}
      </EditorProvider>
    </div>
  );

  return (
    <Field>
      <div className="flex min-w-0 items-center justify-between gap-2">
        {/* A span, not FieldLabel: the target is a contenteditable div rather
            than a form control, so there is nothing for `htmlFor` to point at —
            the association runs the other way, via aria-labelledby. */}
        <span
          className="flex w-fit items-center gap-2 text-sm font-medium leading-none"
          id={labelId}
        >
          {icon ? (
            <span aria-hidden className="flex shrink-0 items-center">
              {icon}
            </span>
          ) : null}
          {label}
          {required ? (
            <span aria-hidden className="ml-1 text-destructive">
              *
            </span>
          ) : null}
          {required ? <span className="sr-only"> (required)</span> : null}
        </span>
      </div>
      {attach && !disabled ? (
        <AttachmentDropzone
          fieldKey={attach.fieldKey}
          fieldLabel={attach.fieldLabel}
          onUploaded={insertAttachments}
          uploader={attach.uploader}
        >
          {editorBox}
        </AttachmentDropzone>
      ) : (
        editorBox
      )}
      {/* The "/" hint only earns its line while the field is writable. */}
      {description || !disabled ? (
        <FieldDescription id={`${id}-hint`}>
          {[
            description,
            disabled
              ? null
              : "Type / for blocks, or use the toolbar to format.",
            // Paste has no affordance of its own — nothing on screen says a
            // screenshot can go straight in, so the hint line has to.
            attach && !disabled
              ? "Paste or drop an image to attach it here."
              : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </FieldDescription>
      ) : null}
    </Field>
  );
}
