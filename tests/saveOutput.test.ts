import { rm, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { savePromptResult } from "../src/services/saveOutput.js";
import type { PromptResult } from "../src/types.js";

const fixture: PromptResult = {
  notebookId: "nb-test",
  artifactId: "art-test",
  artifactType: "slides",
  artifactTitle: "Deck",
  prompt: {
    text: "Make 5 slides.",
    method: "direct",
    confidence: "high",
  },
  retrievedAt: "2026-05-24T00:00:00.000Z",
  warnings: [],
};

describe("savePromptResult", () => {
  it("デフォルトで json と md を保存する", async () => {
    const baseDir = path.resolve(process.cwd(), "outputs", fixture.notebookId);
    await rm(baseDir, { recursive: true, force: true });

    const written = await savePromptResult(fixture);
    expect(written).toHaveLength(2);

    const jsonPath = written.find((p) => p.endsWith(".json"));
    const mdPath = written.find((p) => p.endsWith(".md"));
    expect(jsonPath).toBeTruthy();
    expect(mdPath).toBeTruthy();

    const jsonRaw = await readFile(jsonPath!, "utf8");
    const parsed = JSON.parse(jsonRaw) as PromptResult;
    expect(parsed.artifactId).toBe(fixture.artifactId);
  });

  it("単一format + --out で指定先に保存する", async () => {
    const target = path.resolve(process.cwd(), "outputs", "single.json");
    await rm(target, { force: true });

    const written = await savePromptResult(fixture, {
      format: "json",
      out: target,
    });

    expect(written).toEqual([target]);
    const jsonRaw = await readFile(target, "utf8");
    expect(jsonRaw).toContain('"artifactId": "art-test"');
  });
});
