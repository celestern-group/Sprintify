import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    BETTER_AUTH_URL: "https://app.example.com",
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: "website-id",
    NEXT_PUBLIC_UMAMI_SCRIPT_URL: undefined,
    UMAMI_HOST_URL: "https://analytics.example.com",
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { sendUmamiServerEvent } from "./analytics-server";

describe("sendUmamiServerEvent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the required hostname and only allowlisted analytics data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendUmamiServerEvent({
      action: "invitation.sent",
      targetType: "invitation",
      ipAddress: "203.0.113.10",
      userAgent: "Mozilla/5.0",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://analytics.example.com/api/send",
      expect.objectContaining({
        body: JSON.stringify({
          type: "event",
          payload: {
            website: "website-id",
            hostname: "app.example.com",
            name: "invitation.sent",
            data: { targetType: "invitation" },
            url: "/api/action/invitation.sent",
          },
        }),
      }),
    );
  });
});
