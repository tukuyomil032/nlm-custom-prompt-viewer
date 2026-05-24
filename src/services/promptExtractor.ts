import {
  SUPPORTED_ARTIFACT_TYPES,
  type ArtifactRecord,
  type ListPromptOptions,
  type NotebookLmAdapter,
  type PromptResult,
  type SupportedArtifactType,
} from "../types.js";

const DIRECT_PROMPT_KEYS = new Set([
  "customprompt",
  "custom_prompt",
  "prompt",
  "focusprompt",
  "focus_prompt",
  "instruction",
  "instructions",
  "styleprompt",
  "style_prompt",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSupportedType(type: string): type is SupportedArtifactType {
  return (SUPPORTED_ARTIFACT_TYPES as readonly string[]).includes(type);
}

function normalizePromptText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function collectCandidates(root: unknown): string[] {
  const values: string[] = [];
  const queue: unknown[] = [root];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;

    for (const [key, value] of Object.entries(current)) {
      const normalizedKey = key.toLowerCase();
      if (typeof value === "string" && DIRECT_PROMPT_KEYS.has(normalizedKey) && value.trim()) {
        values.push(value.trim());
      } else if (isRecord(value) || Array.isArray(value)) {
        queue.push(value);
      }
    }
  }

  return values;
}

function pickBestPrompt(candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  return normalizePromptText(sorted[0]);
}

export function summarizePromptText(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 120) return oneLine;
  return `${oneLine.slice(0, 117)}...`;
}

export class PromptExtractorService {
  public constructor(private readonly adapter: NotebookLmAdapter) {}

  public async listPrompts(
    notebookId: string,
    options: ListPromptOptions = {},
  ): Promise<PromptResult[]> {
    const artifacts = await this.adapter.listArtifacts(notebookId);
    const filtered = this.filterArtifacts(artifacts, options.type, options.limit);

    const results: PromptResult[] = [];
    for (const artifact of filtered) {
      const extracted = await this.extractForArtifact(notebookId, artifact);
      if (extracted) results.push(extracted);
    }
    return results;
  }

  public async getPrompt(notebookId: string, artifactId: string): Promise<PromptResult> {
    const artifacts = await this.adapter.listArtifacts(notebookId);
    const artifact = artifacts.find((item) => item.id === artifactId);
    if (!artifact) {
      throw new Error(`artifactId=${artifactId} was not found.`);
    }
    if (!isSupportedType(artifact.type)) {
      throw new Error(
        `artifact type '${artifact.rawType}' is not supported in MVP. Supported: ${SUPPORTED_ARTIFACT_TYPES.join(", ")}`,
      );
    }

    const result = await this.extractForArtifact(notebookId, artifact);
    if (!result) {
      throw new Error("Custom prompt could not be extracted.");
    }
    return result;
  }

  private filterArtifacts(
    artifacts: ArtifactRecord[],
    type?: SupportedArtifactType,
    limit?: number,
  ): ArtifactRecord[] {
    const onlySupported = artifacts.filter((item) => isSupportedType(item.type));
    const byType = type ? onlySupported.filter((item) => item.type === type) : onlySupported;
    return typeof limit === "number" && limit > 0 ? byType.slice(0, limit) : byType;
  }

  private async extractForArtifact(
    notebookId: string,
    artifact: ArtifactRecord,
  ): Promise<PromptResult | null> {
    if (!isSupportedType(artifact.type)) return null;

    const warnings: string[] = [];
    const directCandidates = collectCandidates(artifact.raw);
    const directPrompt = pickBestPrompt(directCandidates);

    if (directPrompt) {
      return {
        notebookId,
        artifactId: artifact.id,
        artifactType: artifact.type,
        artifactTitle: artifact.title,
        prompt: {
          text: directPrompt,
          method: "direct",
          confidence: "high",
        },
        retrievedAt: new Date().toISOString(),
        warnings,
      };
    }

    const fallback = await this.adapter.askNotebookForPrompt(notebookId, artifact);
    if (!fallback) return null;

    warnings.push("Direct extraction failed; recovered via Notebook Q&A inference.");
    return {
      notebookId,
      artifactId: artifact.id,
      artifactType: artifact.type,
      artifactTitle: artifact.title,
      prompt: {
        text: normalizePromptText(fallback),
        method: "qa_fallback",
        confidence: "inferred",
      },
      retrievedAt: new Date().toISOString(),
      warnings,
    };
  }
}

export function formatListRow(result: PromptResult): string {
  return [
    result.artifactId,
    result.artifactType,
    result.prompt.method,
    summarizePromptText(result.prompt.text),
  ].join("\t");
}
