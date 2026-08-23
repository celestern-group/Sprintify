"use client";

import type { Editor } from "@tiptap/core";
import type { EditorEvents } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";
import { ImageIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Markdown } from "tiptap-markdown";
import {
  AttachmentDropzone,
  type AttachmentUploader,
} from "@/components/app/backlog/attachment-dropzone";
import {
  attachmentImageExtension,
  createImagePasteHandler,
  IMAGE_PROSE_CLASS,
  INLINE_IMAGE_ACCEPT,
  insertAttachmentContent,
} from "@/components/app/backlog/editor-images";
import { EditorPickFilesButton } from "@/components/app/backlog/editor-toolbar";
import {
  AI_CANDIDATE,
  MENTION_PROSE_CLASS,
  mentionExtension,
} from "@/components/app/backlog/mention-extension";
import { EditorProvider } from "@/components/kibo-ui/editor";
import type { BacklogMemberRow } from "@/lib/actions/work-items";
import { cn } from "@/lib/utils";
import { COMMENT_ATTACHMENT_FIELD_KEY } from "@/lib/work-item-attachments";

// The comment composer: the same TipTap editor the prose fields use, wired to
// the shared @-mention node in ./mention-extension.tsx.
//
// Storage stays MARKDOWN, exactly like every other prose field — see
// RichTextField. What is specific to a comment is only the sizing and the
// toolbar slot; the mention plumbing is shared so both surfaces serialize a
// mention identically (src/lib/mentions.ts reads exactly one shape).

const markdownExtension = Markdown.configure({
  html: true,
  breaks: true,
  transformPastedText: true,
  transformCopiedText: true,
});

/** Hands the live editor instance back so the caller can clear it on submit. */
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

/**
 * Shared prose styling for the composer and the rendered thread, so a comment
 * looks the same while you write it and after it posts.
 */
export const commentProseStyles = cn(
  "[&_.ProseMirror]:min-h-[inherit] [&_.ProseMirror]:outline-none",
  "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:font-bold [&_h1]:text-lg first:[&_h1]:mt-0",
  "[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:font-semibold [&_h2]:text-base first:[&_h2]:mt-0",
  "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-semibold [&_h3]:text-sm first:[&_h3]:mt-0",
  "[&_p]:my-1 [&_p]:leading-relaxed first:[&_p]:mt-0 last:[&_p]:mb-0",
  "[&_ul]:my-1 [&_ul]:list-outside [&_ul]:list-disc [&_ul]:pl-4",
  "[&_ol]:my-1 [&_ol]:list-outside [&_ol]:list-decimal [&_ol]:pl-4",
  "[&_ul[data-type='taskList']]:my-1 [&_ul[data-type='taskList']]:list-none [&_ul[data-type='taskList']]:p-0 [&_ul[data-type='taskList']_li]:m-0 [&_ul[data-type='taskList']_li>label]:mt-0.5 [&_ul[data-type='taskList']_li>div]:min-w-0 [&_ul[data-type='taskList']_li>div>p]:my-0",
  "[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-background [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2",
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse",
  "[&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left [&_th]:font-semibold",
  MENTION_PROSE_CLASS,
  IMAGE_PROSE_CLASS,
);

export function CommentEditor({
  value,
  onChange,
  members,
  placeholder,
  disabled,
  ariaLabel,
  editorRef,
  aiEnabled,
  toolbar,
  attach,
}: {
  /** Markdown. Seeds the document once — the editor is uncontrolled after. */
  value: string;
  /** Receives markdown. */
  onChange: (markdown: string) => void;
  /** Everyone @-mentionable here: the project's membership. */
  members: BacklogMemberRow[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
  /** Lets the caller clear or refocus the document after a successful post. */
  editorRef?: { current: Editor | null };
  /**
   * Whether @-mentioning the assistant is offered. False when the org has no
   * AI provider — an @Sprintify AI that can never answer is worse than no entry.
   */
  aiEnabled?: boolean;
  /** AI controls, rendered on a bar above the editor. */
  toolbar?: React.ReactNode;
  /**
   * Makes the composer a drop and paste target for files. Absent = neither, which
   * is what a reader without `attachment:create` gets — the same permission that
   * governs the Attachments tab governs a screenshot pasted into a sentence.
   *
   * The files land on the ITEM, filed under Comments: there is no per-comment
   * registry, and a comment can be deleted while the evidence it showed is still
   * evidence.
   */
  attach?: AttachmentUploader;
}) {
  const localRef = useRef<Editor | null>(null);
  const handleRef = editorRef ?? localRef;
  const canAttach = Boolean(attach?.enabled) && !disabled;
  const initialContent = useRef(value);
  // Read through a ref so the suggestion closure — created once, with the
  // extension — always sees the current membership. The assistant goes FIRST
  // so an empty "@" offers it without scrolling: it's the entry people reach
  // for by name, where teammates are looked up by typing one.
  const candidatesRef = useRef<BacklogMemberRow[]>([]);
  candidatesRef.current = aiEnabled ? [AI_CANDIDATE, ...members] : members;
  // The image node is unconditional, exactly as in RichTextField: a composer
  // that may not attach still has to render a picture an existing comment
  // already carries when it opens for editing.
  const extensions = useRef([
    markdownExtension,
    attachmentImageExtension,
    mentionExtension(() => candidatesRef.current),
  ]);

  function handleUpdate({ editor }: EditorEvents["update"]) {
    const markdown = editor.storage.markdown.getMarkdown();
    onChange(markdown.trim() === "" ? "" : markdown);
  }

  const box = (
    <div
      className={cn(
        "rounded-[11px] border border-input bg-transparent transition-shadow",
        "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40",
        disabled && "opacity-50",
      )}
    >
      {/* The bar now earns its line for the picker alone: paste and drop are
          the fast paths, but neither exists for someone on a keyboard with no
          image on the clipboard, or on a phone with the shot in the photo
          roll. The AI controls keep the right-hand side. */}
      {toolbar || (attach && canAttach) ? (
        <div className="flex items-center gap-1 border-b border-border px-1.5 py-1">
          {attach && canAttach ? (
            <EditorPickFilesButton
              accept={INLINE_IMAGE_ACCEPT}
              busy={attach.isUploading(COMMENT_ATTACHMENT_FIELD_KEY)}
              icon={ImageIcon}
              label="Insert an image"
              onFiles={(files) => {
                void attach
                  .upload(files, COMMENT_ATTACHMENT_FIELD_KEY)
                  .then((rows) =>
                    insertAttachmentContent(handleRef.current, rows),
                  );
              }}
            />
          ) : null}
          {toolbar ? (
            <div className="ml-auto flex items-center gap-1">{toolbar}</div>
          ) : null}
        </div>
      ) : null}
      <EditorProvider
        autofocus={false}
        className={cn("w-full px-3 py-2 text-sm min-h-20", commentProseStyles)}
        content={initialContent.current}
        editable={!disabled}
        editorProps={{
          attributes: {
            "aria-label": ariaLabel,
            "aria-multiline": "true",
            role: "textbox",
          },
          ...(attach && canAttach
            ? {
                handlePaste: createImagePasteHandler({
                  fieldKey: COMMENT_ATTACHMENT_FIELD_KEY,
                  uploader: attach,
                  editorRef: handleRef,
                }),
              }
            : {}),
        }}
        extensions={extensions.current}
        immediatelyRender={false}
        onUpdate={handleUpdate}
        placeholder={placeholder}
      >
        <EditorHandle editorRef={handleRef} />
      </EditorProvider>
    </div>
  );

  if (!attach || !canAttach) return box;

  // Same wrapper the prose fields use, so a drop and a paste land in the same
  // place and report progress the same way.
  return (
    <AttachmentDropzone
      fieldKey={COMMENT_ATTACHMENT_FIELD_KEY}
      fieldLabel="this comment"
      onUploaded={(rows) => insertAttachmentContent(handleRef.current, rows)}
      uploader={attach}
    >
      {box}
    </AttachmentDropzone>
  );
}
