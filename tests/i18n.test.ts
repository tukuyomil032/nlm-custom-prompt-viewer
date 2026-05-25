import { describe, expect, it } from "vitest";
import { t } from "../src/i18n/messages.js";

describe("i18n", () => {
  it("falls back to english key values", () => {
    const message = t("en", "errors.badLimit");
    expect(message).toContain(">= 1");
  });

  it("switches to japanese", () => {
    const message = t("ja", "config.reset");
    expect(message).toContain("初期化");
  });

  it("includes download-related messages", () => {
    expect(t("en", "prompt.select.downloadAfterGet")).toContain("Download");
    expect(t("ja", "errors.badSlideFormat")).toContain("slide-format");
    expect(t("ja", "prompt.download.summary")).toContain("downloaded");
  });
});
