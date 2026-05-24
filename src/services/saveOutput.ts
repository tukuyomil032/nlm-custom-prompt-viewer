import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PromptResult } from "../types.js";

export type SaveFormat = "json" | "md";

export interface SaveOptions {
  format?: SaveFormat;
  out?: string;
}

function toMarkdown(result: PromptResult): string {
  const warnings =
    result.warnings.length === 0
      ? "- (none)"
      : result.warnings.map((warning) => `- ${warning}`).join("\n");

  return [
    "# NotebookLM Custom Prompt",
    "",
    `- notebookId: ${result.notebookId}`,
    `- artifactId: ${result.artifactId}`,
    `- artifactType: ${result.artifactType}`,
    `- artifactTitle: ${result.artifactTitle}`,
    `- method: ${result.prompt.method}`,
    `- confidence: ${result.prompt.confidence}`,
    `- retrievedAt: ${result.retrievedAt}`,
    "",
    "## Prompt",
    "",
    "```text",
    result.prompt.text,
    "```",
    "",
    "## Warnings",
    "",
    warnings,
    "",
  ].join("\n");
}

function resolveDefaultTargets(result: PromptResult): Record<SaveFormat, string> {
  const baseDir = path.resolve(process.cwd(), "outputs", result.notebookId);
  return {
    json: path.join(baseDir, `${result.artifactId}.json`),
    md: path.join(baseDir, `${result.artifactId}.md`),
  };
}

async function writeSafely(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

export async function savePromptResult(
  result: PromptResult,
  options: SaveOptions = {},
): Promise<string[]> {
  const requested: SaveFormat[] = options.format ? [options.format] : ["json", "md"];
  const defaults = resolveDefaultTargets(result);
  const written: string[] = [];

  if (options.out) {
    const resolvedOut = path.resolve(process.cwd(), options.out);
    if (requested.length === 1) {
      const format = requested[0];
      const content =
        format === "json" ? `${JSON.stringify(result, null, 2)}\n` : toMarkdown(result);
      await writeSafely(resolvedOut, content);
      return [resolvedOut];
    }

    for (const format of requested) {
      const filename = `${result.artifactId}.${format}`;
      const target = path.join(resolvedOut, filename);
      const content =
        format === "json" ? `${JSON.stringify(result, null, 2)}\n` : toMarkdown(result);
      await writeSafely(target, content);
      written.push(target);
    }
    return written;
  }

  for (const format of requested) {
    const content = format === "json" ? `${JSON.stringify(result, null, 2)}\n` : toMarkdown(result);
    await writeSafely(defaults[format], content);
    written.push(defaults[format]);
  }
  return written;
}
