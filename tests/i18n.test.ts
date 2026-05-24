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
});
