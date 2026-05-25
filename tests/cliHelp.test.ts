import { describe, expect, it } from "vitest";
import stringWidth from "string-width";
import { clipToWidth, createProgram } from "../src/cli.js";
import { t } from "../src/i18n/messages.js";

describe("CLI help", () => {
  function promptHelp(language: "en" | "ja"): string {
    const promptCommand = createProgram(language).commands.find(
      (command) => command.name() === "prompt",
    );
    if (!promptCommand) {
      throw new Error("prompt command not found");
    }
    return promptCommand.helpInformation();
  }

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

  it("documents fast list inference mode", () => {
    const note = t("en", "prompt.list.help");
    expect(note).toContain("--infer");
    expect(note).toContain("data_table");
  });

  it("documents artifact download commands", () => {
    const help = promptHelp("en");
    expect(help).toContain("download-all");
    expect(help).toContain("download");

    const note = t("en", "prompt.download.help");
    expect(note).toContain("prompt download");
    expect(note).toContain("slide-format");
  });

  it("clips japanese text by display width", () => {
    const clipped = clipToWidth("総合型選抜を検討している高校三年生むけの資料", 20);
    expect(stringWidth(clipped)).toBeLessThanOrEqual(20);
    expect(clipped).toContain("...");
  });
});
