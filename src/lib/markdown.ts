import "server-only";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { isAttachmentImageSrc } from "@/lib/attachment-images";

// Markdown → display HTML, for prose the app STORES as markdown (comments
// today; any read-only prose surface later).
//
// This runs on the server only, and that placement is the security property,
// not an implementation detail: the client posts markdown, never HTML, so the
// only HTML that ever reaches a browser is what this function produced from
// stored text. The editor is configured with `html: true` (tables, task lists,
// underline and sub/superscript have no CommonMark syntax), which means a
// determined author CAN put raw tags in the stored markdown — so the output is
// sanitized rather than trusted.
//
// Rendering here rather than mounting a read-only TipTap per comment is also
// what keeps a 50-comment thread cheap: the editor bundle instantiates
// StarterKit plus a full lowlight registry per instance.

const renderer = new marked.Renderer();

/** Everything the work-item editor can produce, and nothing else. */
const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "u",
  "s",
  "del",
  "sub",
  "sup",
  "blockquote",
  "ul",
  "ol",
  "li",
  "code",
  "pre",
  "a",
  // Pasted screenshots. Narrowly gated below: only our own attachment route
  // survives the filter, so an `<img>` here can never be an outbound request.
  "img",
  "span",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "input",
];

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    // No width/height/style/srcset: the layout decides how big a pasted
    // screenshot renders (see the prose styles), not the person who pasted it.
    // `loading`/`decoding` are set by the transform below, never by the author.
    img: ["src", "alt", "title", "loading", "decoding", "class"],
    // The mention node round-trips through raw HTML (see comment-editor.tsx):
    // its data attributes are what let the chip render and what a future
    // "jump to profile" would read.
    span: ["data-type", "data-id", "data-label", "class"],
    code: ["class"],
    pre: ["class"],
    // Task-list checkboxes are rendered, never interactive — `disabled` is
    // re-asserted below so a stored `<input>` can't accept input.
    input: ["type", "checked", "disabled"],
    li: ["data-checked", "data-type"],
    ul: ["data-type"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  // No protocol-relative or javascript: hrefs, and no data: URIs anywhere.
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        // Comment links point at whatever a teammate pasted — treat every one
        // as untrusted outbound.
        target: "_blank",
        rel: "noopener noreferrer nofollow",
      },
    }),
    input: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, type: "checkbox", disabled: "disabled" },
    }),
    img: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        // A screenshot deep in a long thread costs nothing until it is scrolled
        // to, and an alt is required — a picture with no text alternative is a
        // gap in the sentence for a screen reader.
        alt: attribs.alt?.trim() || "Attached image",
        loading: "lazy",
        decoding: "async",
      },
    }),
  },
  // `transformTags` can rewrite a tag but not remove one, and an image whose
  // `src` isn't ours must not survive in any form — see attachment-images.ts for
  // why a foreign `src` is an outbound request made by every reader.
  exclusiveFilter: (frame) =>
    frame.tag === "img" && !isAttachmentImageSrc(frame.attribs.src),
};

/**
 * Render stored markdown to HTML that is safe to inject.
 *
 * Synchronous on purpose: `marked.parse` is only async when an extension
 * registers an async walker, and none is registered here — so callers (list
 * queries mapping many rows) don't have to await per row.
 */
export function renderMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return "";

  const html = marked.parse(trimmed, {
    renderer,
    gfm: true,
    // Single newlines are line breaks, matching the editor's Markdown
    // configuration (`breaks: true`) — otherwise a comment typed as three
    // lines renders as one paragraph.
    breaks: true,
    async: false,
  });

  return sanitizeHtml(html, sanitizeOptions);
}

/**
 * Stored markdown as PLAIN text — for embeddings, notification previews and
 * anywhere a sentence is wanted rather than a document. Strips every tag
 * (including the raw-HTML ones markdown can carry) and collapses whitespace.
 */
export function markdownToPlainText(markdown: string): string {
  const html = renderMarkdown(markdown);
  if (!html) return "";

  const text = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    // Without this, `<p>a</p><p>b</p>` collapses to "ab".
    textFilter: (part) => `${part} `,
  });

  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

/**
 * sanitize-html escapes text output, so stripping tags leaves entities behind.
 * Only the five that `sanitize-html` itself emits need reversing.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
