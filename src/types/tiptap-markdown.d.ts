import type { MarkdownStorage } from "tiptap-markdown";

// tiptap-markdown ships its storage type but never augments Tiptap's own
// `Storage` interface, so `editor.storage.markdown.getMarkdown()` — the only
// way to read the markdown back out — is otherwise a type error under v3.
declare module "@tiptap/core" {
  interface Storage {
    markdown: MarkdownStorage;
  }
}
