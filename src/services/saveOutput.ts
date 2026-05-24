import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { PromptResult } from "../types.js";

export type SaveFormat = "json" | "md";

export interface SaveOptions {
  format?: SaveFormat;
  out?: string;
}

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(homedir(), p.slice(2));
  }
  return p;
}

function hasFileExtension(p: string): boolean {
  const ext = path.extname(p);
  return ext === ".json" || ext === ".md";
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  const slug = slugify(result.artifactTitle) || result.artifactId;
  const baseDir = path.resolve(process.cwd(), "outputs");
  return {
    json: path.join(baseDir, `${slug}.json`),
    md: path.join(baseDir, `${slug}.md`),
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
    const resolvedOut = path.resolve(process.cwd(), expandTilde(options.out));

    if (hasFileExtension(options.out) && requested.length === 1) {
      const format = requested[0];
      const content =
        format === "json" ? `${JSON.stringify(result, null, 2)}\n` : toMarkdown(result);
      await writeSafely(resolvedOut, content);
      return [resolvedOut];
    }

    const slug = slugify(result.artifactTitle) || result.artifactId;
    for (const format of requested) {
      const target = path.join(resolvedOut, `${slug}.${format}`);
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
