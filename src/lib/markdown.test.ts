import { describe, expect, it } from "vitest";
import { markdownToPlainText, renderMarkdown } from "@/lib/markdown";

// The sanitizer is the XSS boundary for every piece of stored prose. These
// cover the `img` allowance specifically: it is the newest hole in the
// allow-list and the only one whose value depends on an attribute rather than
// on the tag.

const OURS = "/api/work-items/wi_1/attachments/at_1?inline=1";

describe("renderMarkdown images", () => {
  it("renders an attachment image", () => {
    const html = renderMarkdown(`![screenshot.png](${OURS})`);
    expect(html).toContain(`src="${OURS}"`);
    expect(html).toContain('alt="screenshot.png"');
    expect(html).toContain('loading="lazy"');
  });

  it("supplies an alt when the author left none", () => {
    expect(renderMarkdown(`![](${OURS})`)).toContain('alt="Attached image"');
  });

  it("drops an image pointing anywhere else", () => {
    // The attack: a tracking pixel that reports every reader of the item.
    const html = renderMarkdown("![](https://evil.example/pixel.png)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
  });

  it("drops only the image, not the sentence around it", () => {
    // sanitize-html's exclusiveFilter truncates at the tag position, so this is
    // worth pinning: a rejected image must not take the rest of the paragraph.
    const html = renderMarkdown("Before ![](https://evil.example/p.png) after");
    expect(html).not.toContain("<img");
    expect(
      markdownToPlainText("Before ![](https://evil.example/p.png) after"),
    ).toBe("Before after");
  });

  it("drops a raw <img> tag with a foreign src", () => {
    const html = renderMarkdown('<img src="https://evil.example/p.png">');
    expect(html).not.toContain("<img");
  });

  it("strips an event handler from an otherwise valid image", () => {
    const html = renderMarkdown(`<img src="${OURS}" onerror="alert(1)">`);
    expect(html).toContain("<img");
    expect(html).not.toContain("onerror");
  });

  it("refuses author-supplied sizing — the layout decides", () => {
    const html = renderMarkdown(
      `<img src="${OURS}" width="4000" style="position:fixed">`,
    );
    expect(html).not.toContain("width");
    expect(html).not.toContain("style");
  });

  it("leaves an image out of the plain-text form", () => {
    expect(markdownToPlainText(`Before ![shot](${OURS}) after`)).toBe(
      "Before after",
    );
  });
});
