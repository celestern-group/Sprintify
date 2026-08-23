import { describe, expect, it } from "vitest";
import {
  batchedForUpload,
  MAX_ATTACHMENTS_PER_ITEM,
  MAX_ATTACHMENTS_PER_REQUEST,
} from "@/lib/work-item-attachments";

describe("batchedForUpload", () => {
  it("keeps a drop that fits in one request as one request", () => {
    expect(batchedForUpload([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("splits at the size and preserves order", () => {
    expect(batchedForUpload([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("has nothing to send for an empty drop", () => {
    expect(batchedForUpload([], 10)).toEqual([]);
  });

  it("splits a full item's worth of files into acceptable requests", () => {
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_ITEM }, (_, i) => i);
    const batches = batchedForUpload(files, MAX_ATTACHMENTS_PER_REQUEST);

    // The point of the helper: the per-item cap is reachable in one drop, and
    // no request may carry more than the route accepts.
    expect(batches.flat()).toEqual(files);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(MAX_ATTACHMENTS_PER_REQUEST);
    }
  });

  it("is only useful because the two limits differ", () => {
    expect(MAX_ATTACHMENTS_PER_REQUEST).toBeLessThan(MAX_ATTACHMENTS_PER_ITEM);
  });
});
