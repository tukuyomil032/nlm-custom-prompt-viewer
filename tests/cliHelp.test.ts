import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli.js";
import { t } from "../src/i18n/messages.js";

describe("CLI help", () => {
  it("shows root help in english", () => {
    const help = createProgram("en").helpInformation();
    expect(help).toContain("NotebookLM custom prompt helper CLI");
    expect(help).toContain("prompt");
  });

  it("switches root help language to japanese", () => {
    const help = createProgram("ja").helpInformation();
    expect(help).toContain("NotebookLM Studio成果物のカスタムプロンプトを取得・保存します。");
    expect(help).toContain("NotebookLMカスタムプロンプト補助CLI");
  });

  it("shows manual id fallback note in prompt help", () => {
    const note = t("en", "prompt.list.help");
    expect(note).toContain("entering notebookId manually");
  });
});
