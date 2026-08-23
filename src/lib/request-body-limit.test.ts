import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readLimitedFormData } from "./request-body-limit";

/** Serializes a FormData the way a browser would, so tests can replay the bytes. */
async function multipart(form: FormData) {
  const request = new Request("https://example.test/upload", {
    method: "POST",
    body: form,
  });
  return {
    contentType: request.headers.get("content-type") ?? "",
    bytes: new Uint8Array(await request.arrayBuffer()),
  };
}

function fileForm(size: number) {
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array(size)], "blob.bin", {
      type: "application/octet-stream",
    }),
  );
  return form;
}

/** A chunked upload: a streamed body, no `Content-Length` to check up front. */
function chunkedRequest(bytes: Uint8Array, contentType: string) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.byteLength; at += 8 * 1024) {
        controller.enqueue(bytes.slice(at, at + 8 * 1024));
      }
      controller.close();
    },
  });
  return new Request("https://example.test/upload", {
    method: "POST",
    headers: { "content-type": contentType },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("readLimitedFormData", () => {
  it("parses a body under the cap", async () => {
    const { bytes, contentType } = await multipart(fileForm(1024));
    const form = await readLimitedFormData(
      chunkedRequest(bytes, contentType),
      1024 * 1024,
    );
    const file = form?.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).size).toBe(1024);
  });

  it("rejects on Content-Length before reading any bytes", async () => {
    const { bytes, contentType } = await multipart(fileForm(64 * 1024));
    const request = new Request("https://example.test/upload", {
      method: "POST",
      headers: {
        "content-type": contentType,
        "content-length": String(bytes.byteLength),
      },
      body: bytes,
    });
    await expect(readLimitedFormData(request, 1024)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
    // Untouched: the guard ran ahead of the parse.
    expect(request.bodyUsed).toBe(false);
  });

  it("rejects a chunked body that omits Content-Length", async () => {
    const { bytes, contentType } = await multipart(fileForm(256 * 1024));
    const request = chunkedRequest(bytes, contentType);
    expect(request.headers.get("content-length")).toBeNull();
    await expect(
      readLimitedFormData(request, 32 * 1024),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("returns null for a body that is not form data", async () => {
    const request = new Request("https://example.test/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await expect(readLimitedFormData(request, 1024 * 1024)).resolves.toBeNull();
  });
});
