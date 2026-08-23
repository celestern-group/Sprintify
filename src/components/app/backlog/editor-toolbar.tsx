"use client";

import type { Editor } from "@tiptap/core";
import { useCurrentEditor, useEditorState } from "@tiptap/react";
import {
  BoldIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  PaperclipIcon,
  RemoveFormattingIcon,
  SquareCodeIcon,
  StrikethroughIcon,
  TableIcon,
  TextQuoteIcon,
  UnderlineIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { INLINE_IMAGE_ACCEPT } from "@/components/app/backlog/editor-images";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// A persistent formatting bar for the prose editors — the same commands the
// bubble/floating menus ran, except they no longer have to be discovered by
// hovering or selecting. The buttons live INSIDE the editor's context (render
// them through `slotBefore`), so each one reads the live editor rather than
// taking one as a prop.

/**
 * Every mark/node the bar reflects, read as one snapshot. `useCurrentEditor`
 * only hands over the instance — it does not re-render on a transaction — so
 * without this subscription the pressed states would freeze at whatever they
 * were when the field mounted.
 */
function useToolbarState(editor: Editor | null) {
  return useEditorState({
    editor,
    selector: ({ editor: instance }) =>
      instance
        ? {
            blockquote: instance.isActive("blockquote"),
            bold: instance.isActive("bold"),
            bulletList: instance.isActive("bulletList"),
            code: instance.isActive("code"),
            codeBlock: instance.isActive("codeBlock"),
            heading1: instance.isActive("heading", { level: 1 }),
            heading2: instance.isActive("heading", { level: 2 }),
            heading3: instance.isActive("heading", { level: 3 }),
            italic: instance.isActive("italic"),
            link: instance.isActive("link"),
            orderedList: instance.isActive("orderedList"),
            strike: instance.isActive("strike"),
            taskList: instance.isActive("taskList"),
            underline: instance.isActive("underline"),
          }
        : null,
  });
}

function ToolbarButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: typeof BoldIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={active ?? false}
            className={cn(
              "size-7 [&_svg:not([class*='size-'])]:size-3.5",
              // Filled violet tint for the pressed state — the system's
              // selection language, never an outline.
              active &&
                "bg-secondary text-secondary-foreground hover:bg-secondary",
            )}
            // Keep the selection the command is about to act on: a plain
            // mousedown on the button would blur the document first.
            onClick={onClick}
            onMouseDown={(event) => event.preventDefault()}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Icon />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Pick files from the bar.
 *
 * The same act as dropping them on this field — they upload, are filed under
 * the field, and are written at the caret — but reachable from a keyboard and on
 * touch, where neither dragging nor a clipboard image exists. A real `<input
 * type="file">` does the picking; the button only clicks it, because no script
 * can open a file dialog on its own.
 *
 * `accept` narrows the dialog, it does not enforce anything: a person can always
 * switch the picker back to "all files", and the route re-checks types and sizes
 * regardless. It is there so the image button opens on the photo roll rather
 * than on a folder of documents.
 */
export function EditorPickFilesButton({
  busy,
  onFiles,
  accept,
  icon: Icon,
  label,
}: {
  busy: boolean;
  onFiles: (files: File[]) => void;
  accept?: string;
  icon: typeof PaperclipIcon;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              className="size-7 [&_svg:not([class*='size-'])]:size-3.5"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              // Same reason as the formatting buttons: a plain mousedown would
              // blur the document and lose the caret the file lands at.
              onMouseDown={(event) => event.preventDefault()}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              {busy ? <Spinner /> : <Icon />}
            </Button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <input
        accept={accept}
        className="sr-only"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Cleared so picking the same file twice still fires a change.
          event.target.value = "";
          onFiles(files);
        }}
        ref={inputRef}
        type="file"
      />
    </>
  );
}

/** "example.com" is a link the way people write one; give it a scheme. */
function normalizeUrl(text: string): string | null {
  const trimmed = text.trim();

  if (trimmed === "" || trimmed.includes(" ")) {
    return null;
  }

  try {
    return new URL(
      /^[a-z][\w+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`,
    ).toString();
  } catch {
    return null;
  }
}

function LinkButton({ active, editor }: { active: boolean; editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  function handleOpenChange(next: boolean) {
    if (next) {
      const href = (editor.getAttributes("link") as { href?: string }).href;
      setUrl(href ?? "");
    }
    setOpen(next);
  }

  function apply() {
    const href = normalizeUrl(url);

    if (!href) {
      return;
    }

    // With nothing selected there is no text to carry the mark, so the URL
    // becomes its own link text rather than the command silently no-opping.
    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: href,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    } else {
      editor.chain().focus().setLink({ href }).run();
    }

    setOpen(false);
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label="Link"
            aria-pressed={active}
            className={cn(
              "size-7 [&_svg:not([class*='size-'])]:size-3.5",
              active &&
                "bg-secondary text-secondary-foreground hover:bg-secondary",
            )}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <LinkIcon />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-64 gap-2 p-2">
        <Input
          aria-label="Link URL"
          className="h-8"
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              // The field can sit inside a form — Enter means "apply this
              // link", never "submit the item".
              event.preventDefault();
              apply();
            }
          }}
          placeholder="Paste a link"
          value={url}
        />
        <div className="flex items-center justify-end gap-1">
          {active ? (
            <Button
              onClick={() => {
                editor.chain().focus().unsetLink().run();
                setOpen(false);
              }}
              size="sm"
              type="button"
              variant="destructive"
            >
              Remove
            </Button>
          ) : null}
          <Button onClick={apply} size="sm" type="button" variant="outline">
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The bar itself. `children` is the right-hand slot — where the AI control
 * sits, so a field has one bar rather than two stacked ones.
 */
export function EditorToolbar({
  children,
  attach,
}: {
  children?: React.ReactNode;
  /**
   * Absent = this field takes no attachments, so the bar shows no paperclip.
   * The bar stays dumb about uploading: it hands the picked files back and the
   * field decides what happens to them (see RichTextField).
   */
  attach?: { busy: boolean; onFiles: (files: File[]) => void };
}) {
  const { editor } = useCurrentEditor();
  const state = useToolbarState(editor ?? null);

  if (!editor || !state) {
    return null;
  }

  return (
    <div
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1"
      role="toolbar"
    >
      <ToolbarButton
        active={state.bold}
        icon={BoldIcon}
        label="Bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        active={state.italic}
        icon={ItalicIcon}
        label="Italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        active={state.underline}
        icon={UnderlineIcon}
        label="Underline"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <ToolbarButton
        active={state.strike}
        icon={StrikethroughIcon}
        label="Strikethrough"
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToolbarButton
        active={state.code}
        icon={CodeIcon}
        label="Inline code"
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <LinkButton active={state.link} editor={editor} />
      {/* Beside Link, because all three point at something outside the
          sentence. Two buttons rather than one: the image picker opens on
          pictures and its result lands INLINE, where the paperclip takes
          anything and lands as a link — same upload, different intent, and a
          single control could not say which you meant. */}
      {attach ? (
        <>
          <EditorPickFilesButton
            accept={INLINE_IMAGE_ACCEPT}
            busy={attach.busy}
            icon={ImageIcon}
            label="Insert an image"
            onFiles={attach.onFiles}
          />
          <EditorPickFilesButton
            busy={attach.busy}
            icon={PaperclipIcon}
            label="Attach a file"
            onFiles={attach.onFiles}
          />
        </>
      ) : null}
      <Separator className="mx-1 h-4" orientation="vertical" />
      <ToolbarButton
        active={state.heading1}
        icon={Heading1Icon}
        label="Heading 1"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <ToolbarButton
        active={state.heading2}
        icon={Heading2Icon}
        label="Heading 2"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToolbarButton
        active={state.heading3}
        icon={Heading3Icon}
        label="Heading 3"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />
      <Separator className="mx-1 h-4" orientation="vertical" />
      <ToolbarButton
        active={state.bulletList}
        icon={ListIcon}
        label="Bulleted list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        active={state.orderedList}
        icon={ListOrderedIcon}
        label="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        active={state.taskList}
        icon={ListTodoIcon}
        label="Task list"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      />
      <Separator className="mx-1 h-4" orientation="vertical" />
      <ToolbarButton
        active={state.blockquote}
        icon={TextQuoteIcon}
        label="Quote"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToolbarButton
        active={state.codeBlock}
        icon={SquareCodeIcon}
        label="Code block"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
      <ToolbarButton
        icon={TableIcon}
        label="Insert table"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      />
      <ToolbarButton
        icon={RemoveFormattingIcon}
        label="Clear formatting"
        onClick={() =>
          editor.chain().focus().clearNodes().unsetAllMarks().run()
        }
      />
      {children ? (
        <div className="ml-auto flex items-center gap-1">{children}</div>
      ) : null}
    </div>
  );
}
