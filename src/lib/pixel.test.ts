import { beforeEach, describe, expect, it, vi } from "vitest";

const { testEnv } = vi.hoisted(() => ({
  testEnv: {
    NEXT_PUBLIC_UMAMI_PIXEL_ID: undefined as string | undefined,
    NEXT_PUBLIC_UMAMI_SCRIPT_URL: undefined as string | undefined,
    UMAMI_HOST_URL: undefined as string | undefined,
    UMAMI_PIXEL_ID: undefined as string | undefined,
  },
}));

vi.mock("@/env", () => ({ env: testEnv }));

import {
  getPixelHtml,
  getUmamiHostUrl,
  getUmamiPixelUrl,
  resolvePixelId,
} from "./pixel";

describe("Umami Tracking Pixel", () => {
  beforeEach(() => {
    testEnv.UMAMI_HOST_URL = undefined;
    testEnv.NEXT_PUBLIC_UMAMI_SCRIPT_URL = undefined;
    testEnv.UMAMI_PIXEL_ID = undefined;
    testEnv.NEXT_PUBLIC_UMAMI_PIXEL_ID = undefined;
  });

  describe("getUmamiHostUrl", () => {
    it("returns default cloud URL when no env or override is set", () => {
      expect(getUmamiHostUrl()).toBe("https://cloud.umami.is");
    });

    it("respects host override", () => {
      expect(getUmamiHostUrl("https://analytics.example.com/")).toBe(
        "https://analytics.example.com",
      );
    });

    it("reads UMAMI_HOST_URL from validated environment", () => {
      testEnv.UMAMI_HOST_URL = "https://custom-umami.internal";
      expect(getUmamiHostUrl()).toBe("https://custom-umami.internal");
    });

    it("derives origin from NEXT_PUBLIC_UMAMI_SCRIPT_URL", () => {
      testEnv.NEXT_PUBLIC_UMAMI_SCRIPT_URL =
        "https://telemetry.example.com/script.js";
      expect(getUmamiHostUrl()).toBe("https://telemetry.example.com");
    });
  });

  describe("resolvePixelId", () => {
    it("returns explicit ID when provided", () => {
      expect(resolvePixelId("custom-id-123")).toBe("custom-id-123");
    });

    it("falls back to UMAMI_PIXEL_ID", () => {
      testEnv.UMAMI_PIXEL_ID = "env-pixel-1";
      expect(resolvePixelId()).toBe("env-pixel-1");
    });

    it("falls back to NEXT_PUBLIC_UMAMI_PIXEL_ID", () => {
      testEnv.NEXT_PUBLIC_UMAMI_PIXEL_ID = "client-pixel-2";
      expect(resolvePixelId()).toBe("client-pixel-2");
    });

    it("returns null when no pixel ID is configured", () => {
      expect(resolvePixelId()).toBeNull();
    });
  });

  describe("getUmamiPixelUrl", () => {
    it("builds the correct Umami pixel URL from slug/ID", () => {
      const url = getUmamiPixelUrl("uvTU00XJB", "https://umami.celestern.com");
      expect(url).toBe("https://umami.celestern.com/p/uvTU00XJB");
    });

    it("handles full URL when passed as pixelId directly", () => {
      const url = getUmamiPixelUrl("https://umami.celestern.com/p/uvTU00XJB");
      expect(url).toBe("https://umami.celestern.com/p/uvTU00XJB");
    });

    it("returns null when no ID is provided or resolved", () => {
      expect(getUmamiPixelUrl()).toBeNull();
    });
  });

  describe("getPixelHtml", () => {
    it("generates an invisible img tag", () => {
      const html = getPixelHtml("px_abc123", "https://umami.mysite.com");
      expect(html).toBe(
        '<img src="https://umami.mysite.com/p/px_abc123" width="1" height="1" style="display:none;" alt="" />',
      );
    });

    it("returns empty string when no pixel ID is configured", () => {
      expect(getPixelHtml()).toBe("");
    });
  });
});
