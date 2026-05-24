import { describe, expect, it } from "vitest";
import { checkForUpdates, isNewerVersion, shouldSkipCachedCheck } from "../src/update/checker.js";
import { DEFAULT_CONFIG } from "../src/config/types.js";

describe("update checker", () => {
  it("detects newer semantic versions", () => {
    expect(isNewerVersion("0.1.0", "0.1.1")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("1.2.0", "1.1.9")).toBe(false);
  });

  it("skips checks within 24h cache window", () => {
    const now = new Date().toISOString();
    expect(shouldSkipCachedCheck(now)).toBe(true);
  });

  it("checks and persists latest version", async () => {
    const response = {
      ok: true,
      json: async () => ({ version: "0.2.0" }),
    } as Response;

    const result = await checkForUpdates({
      packageName: "nlm-custom-prompt-viewer",
      currentVersion: "0.1.0",
      config: DEFAULT_CONFIG,
      force: true,
      fetcher: async () => response,
    });

    expect(result.checked).toBe(true);
    expect(result.latestVersion).toBe("0.2.0");
    expect(result.hasUpdate).toBe(true);
    expect(result.nextConfig.updateCheck.latestSeenVersion).toBe("0.2.0");
  });
});
