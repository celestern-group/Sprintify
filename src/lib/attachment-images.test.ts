import { describe, expect, it } from "vitest";
import { imageFilesFrom, isAttachmentImageSrc } from "@/lib/attachment-images";

// The `src` predicate is a security boundary (see attachment-images.ts): it is
// the only thing standing between a prose field and an outbound request made by
// every reader of the item. Every "no" below is a real attack shape, not a
// hypothetical.

describe("isAttachmentImageSrc", () => {
  it("accepts our own attachment preview", () => {
    expect(
      isAttachmentImageSrc(
        "/api/work-items/abc123/attachments/def456?inline=1",
      ),
    ).toBe(true);
  });

  it("rejects an external host", () => {
    expect(isAttachmentImageSrc("https://evil.example/pixel.png")).toBe(false);
  });

  it("rejects a protocol-relative URL", () => {
    // A browser resolves this off-origin, so it must not survive the anchor.
    expect(
      isAttachmentImageSrc(
        "//evil.example/api/work-items/a/attachments/b?inline=1",
      ),
    ).toBe(false);
  });

  it("rejects an absolute URL that merely contains the path", () => {
    expect(
      isAttachmentImageSrc(
        "https://evil.example/api/work-items/a/attachments/b?inline=1",
      ),
    ).toBe(false);
  });

  it("rejects a data URI", () => {
    expect(isAttachmentImageSrc("data:image/png;base64,AAAA")).toBe(false);
  });

  it("rejects the download URL — only the inline form renders", () => {
    expect(isAttachmentImageSrc("/api/work-items/a/attachments/b")).toBe(false);
  });

  it("rejects a traversal into another route", () => {
    expect(
      isAttachmentImageSrc("/api/work-items/../admin/attachments/b?inline=1"),
    ).toBe(false);
  });

  it("rejects extra query parameters", () => {
    expect(
      isAttachmentImageSrc("/api/work-items/a/attachments/b?inline=1&x=2"),
    ).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isAttachmentImageSrc(undefined)).toBe(false);
  });
});

/** A clipboard payload, minus everything `imageFilesFrom` never touches. */
function clipboard(files: File[]): DataTransfer {
  return { files } as unknown as DataTransfer;
}

describe("imageFilesFrom", () => {
  const at = new Date("2026-08-11T09:30:15.000Z");

  it("keeps only images", () => {
    const files = imageFilesFrom(
      clipboard([
        new File(["a"], "notes.txt", { type: "text/plain" }),
        new File(["b"], "shot.png", { type: "image/png" }),
      ]),
      at,
    );
    expect(files.map((file) => file.name)).toEqual(["shot.png"]);
  });

  it("names an OS screenshot after the moment it was pasted", () => {
    const [file] = imageFilesFrom(
      clipboard([new File(["b"], "image.png", { type: "image/png" })]),
      at,
    );
    expect(file.name).toBe("pasted-image-2026-08-11-09-30-15.png");
    expect(file.type).toBe("image/png");
  });

  it("keeps a name the clipboard actually supplied", () => {
    const [file] = imageFilesFrom(
      clipboard([new File(["b"], "login-error.png", { type: "image/png" })]),
      at,
    );
    expect(file.name).toBe("login-error.png");
  });

  it("keeps several images from one paste apart", () => {
    const files = imageFilesFrom(
      clipboard([
        new File(["a"], "image.png", { type: "image/png" }),
        new File(["b"], "", { type: "image/jpeg" }),
      ]),
      at,
    );
    expect(files.map((file) => file.name)).toEqual([
      "pasted-image-2026-08-11-09-30-15.png",
      "pasted-image-2026-08-11-09-30-15-2.jpeg",
    ]);
  });

  it("is empty for no clipboard at all", () => {
    expect(imageFilesFrom(null)).toEqual([]);
  });
});
