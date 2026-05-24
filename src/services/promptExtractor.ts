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

export interface PromptListFailure {
  artifactId: string;
  artifactTitle: string;
  artifactType: string;
  reason: "unsupported_type" | "not_extracted" | "extraction_failed";
}

export interface PromptListEntry {
  artifactId: string;
  artifactTitle: string;
  artifactType: string;
  prompt: PromptResult | null;
  failure: PromptListFailure | null;
}

export interface PromptListDetailedResult {
  results: PromptResult[];
  failures: PromptListFailure[];
  entries: PromptListEntry[];
}

export function summarizePromptText(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 120) return oneLine;
  return `${oneLine.slice(0, 117)}...`;
}

async function mapLimit<T, U>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = Array.from<U>({ length: items.length });
  let nextIndex = 0;

  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}

export class PromptExtractorService {
  public constructor(private readonly adapter: NotebookLmAdapter) {}

  public async listPrompts(
    notebookId: string,
    options: ListPromptOptions = {},
  ): Promise<PromptResult[]> {
    const detailed = await this.listPromptsDetailed(notebookId, options);
    return detailed.results;
  }

  public async listPromptsDetailed(
    notebookId: string,
    options: ListPromptOptions = {},
  ): Promise<PromptListDetailedResult> {
    const artifacts = await this.adapter.listArtifacts(notebookId);
    const { targets, skippedUnsupported } = this.partitionArtifacts(
      artifacts,
      options.type,
      options.limit,
    );

    const results: PromptResult[] = [];
    const entries: PromptListEntry[] = [];
    const failures: PromptListFailure[] = skippedUnsupported.map((artifact) => ({
      artifactId: artifact.id,
      artifactTitle: artifact.title,
      artifactType: artifact.rawType,
      reason: "unsupported_type",
    }));
    for (const failure of failures) {
      entries.push({
        artifactId: failure.artifactId,
        artifactTitle: failure.artifactTitle,
        artifactType: failure.artifactType,
        prompt: null,
        failure,
      });
    }

    const extractedTargets = options.infer
      ? await mapLimit(targets, 2, (artifact) => this.extractForArtifact(notebookId, artifact))
      : targets.map((artifact) => this.extractDirectForArtifact(notebookId, artifact));

    for (const [index, artifact] of targets.entries()) {
      const extracted = extractedTargets[index];
      if (extracted) {
        results.push(extracted);
        entries.push({
          artifactId: artifact.id,
          artifactTitle: artifact.title,
          artifactType: artifact.type,
          prompt: extracted,
          failure: null,
        });
      } else {
        const failure: PromptListFailure = {
          artifactId: artifact.id,
          artifactTitle: artifact.title,
          artifactType: artifact.rawType,
          reason: options.infer ? "extraction_failed" : "not_extracted",
        };
        failures.push(failure);
        entries.push({
          artifactId: artifact.id,
          artifactTitle: artifact.title,
          artifactType: artifact.type,
          prompt: null,
          failure,
        });
      }
    }
    return { results, failures, entries };
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

  private partitionArtifacts(
    artifacts: ArtifactRecord[],
    type?: SupportedArtifactType,
    limit?: number,
  ): {
    targets: ArtifactRecord[];
    skippedUnsupported: ArtifactRecord[];
  } {
    const onlySupported = artifacts.filter((item) => isSupportedType(item.type));
    const byType = type ? onlySupported.filter((item) => item.type === type) : onlySupported;
    const limited = typeof limit === "number" && limit > 0 ? byType.slice(0, limit) : byType;
    const skippedUnsupported =
      type === undefined ? artifacts.filter((item) => !isSupportedType(item.type)) : [];
    return {
      targets: limited,
      skippedUnsupported,
    };
  }

  private async extractForArtifact(
    notebookId: string,
    artifact: ArtifactRecord,
  ): Promise<PromptResult | null> {
    if (!isSupportedType(artifact.type)) return null;

    const direct = this.extractDirectForArtifact(notebookId, artifact);
    if (direct) return direct;

    const fallback = await this.adapter.askNotebookForPrompt(notebookId, artifact);
    if (!fallback) return null;

    const warnings: string[] = [];
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

  private extractDirectForArtifact(
    notebookId: string,
    artifact: ArtifactRecord,
  ): PromptResult | null {
    if (!isSupportedType(artifact.type)) return null;

    const directCandidates = collectCandidates(artifact.raw);
    const directPrompt = pickBestPrompt(directCandidates);
    if (!directPrompt) return null;

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
      warnings: [],
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
