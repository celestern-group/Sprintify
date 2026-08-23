import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

// Precache revision for the offline fallback — pin to the current git commit so
// it changes on every deploy; fall back to a random id when git isn't available.
const revision =
  spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf-8",
  }).stdout?.trim() || crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [{ url: "/~offline", revision }],
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
  });
