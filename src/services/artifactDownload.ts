import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { slugify } from "./saveOutput.js";
import type {
  ArtifactDownloadAdapter,
  ArtifactDownloadInfo,
  ArtifactRecord,
  BinaryDownloadProgress,
} from "../types.js";

export type SlideDownloadFormat = "pdf" | "pptx";

export interface BinaryProgressHandle {
  update(progress: BinaryDownloadProgress): void;
  stop(): void;
}

export interface DownloadProgressContext {
  artifactId: string;
  artifactTitle: string;
  artifactType: ArtifactRecord["type"];
  targetPath: string;
}

export interface DownloadArtifactOptions {
  out?: string;
  slideFormat?: SlideDownloadFormat;
  progressFactory?: (context: DownloadProgressContext) => BinaryProgressHandle;
}

export interface DownloadedArtifact {
  artifactId: string;
  artifactTitle: string;
  artifactType: ArtifactRecord["type"];
  path: string;
}

export interface SkippedArtifact {
  artifactId: string;
  artifactTitle: string;
  artifactType: string;
  reason: "unsupported_type" | "not_ready" | "not_exportable" | "missing" | "download_failed";
  detail?: string;
}

export interface DownloadAllResult {
  downloaded: DownloadedArtifact[];
  skipped: SkippedArtifact[];
  failed: SkippedArtifact[];
}

interface MaterializedArtifact {
  ext: string;
  mode: "binary" | "text";
  url?: string;
  content?: string;
}

function expandTilde(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(homedir(), input.slice(2));
  }
  return input;
}

function hasKnownFileExtension(target: string): boolean {
  return path.extname(target).length > 0;
}

function isReadyStatus(status: string | null): boolean {
  if (!status) return false;
  return /completed|ready/i.test(status);
}

function ensureTrailingNewline(input: string): string {
  return input.endsWith("\n") ? input : `${input}\n`;
}

function encodeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(encodeCsvCell).join(","));
  return ensureTrailingNewline(lines.join("\n"));
}

export function defaultDownloadDirectory(notebookId: string): string {
  return path.resolve(process.cwd(), "outputs", "downloads", notebookId);
}

export function defaultDownloadExtension(
  artifactType: ArtifactRecord["type"],
  slideFormat: SlideDownloadFormat = "pdf",
): string | null {
  switch (artifactType) {
    case "audio":
      return "mp3";
    case "video":
      return "mp4";
    case "slides":
      return slideFormat;
    case "infographic":
      return "png";
    case "report":
      return "md";
    case "quiz":
    case "flashcards":
      return "html";
    case "data_table":
      return "csv";
    case "mind_map":
      return "json";
    default:
      return null;
  }
}

function defaultFilename(info: ArtifactDownloadInfo, ext: string): string {
  return `${slugify(info.artifactTitle) || info.artifactId}.${ext}`;
}

function resolveSingleTargetPath(
  notebookId: string,
  info: ArtifactDownloadInfo,
  ext: string,
  out?: string,
): string {
  if (!out) {
    return path.join(defaultDownloadDirectory(notebookId), defaultFilename(info, ext));
  }

  const resolvedOut = path.resolve(process.cwd(), expandTilde(out));
  if (hasKnownFileExtension(out)) {
    return resolvedOut;
  }
  return path.join(resolvedOut, defaultFilename(info, ext));
}

function resolveBulkTargetPath(
  notebookId: string,
  info: ArtifactDownloadInfo,
  ext: string,
  out?: string,
): string {
  const baseDir = out
    ? path.resolve(process.cwd(), expandTilde(out))
    : defaultDownloadDirectory(notebookId);
  return path.join(baseDir, defaultFilename(info, ext));
}

function materializeArtifact(
  info: ArtifactDownloadInfo,
  slideFormat: SlideDownloadFormat,
): MaterializedArtifact | null {
  switch (info.artifactType) {
    case "audio":
      if (!isReadyStatus(info.status) || !info.audioUrl) return null;
      return { ext: "mp3", mode: "binary", url: info.audioUrl };
    case "video":
      if (!isReadyStatus(info.status) || !info.videoUrl) return null;
      return { ext: "mp4", mode: "binary", url: info.videoUrl };
    case "slides": {
      const url = slideFormat === "pptx" ? info.slidePptxUrl : info.slidePdfUrl;
      if (!isReadyStatus(info.status) || !url) return null;
      return { ext: slideFormat, mode: "binary", url };
    }
    case "infographic":
      if (!isReadyStatus(info.status) || !info.infographicUrl) return null;
      return { ext: "png", mode: "binary", url: info.infographicUrl };
    case "report":
      if (!info.reportMarkdown) return null;
      return {
        ext: "md",
        mode: "text",
        content: ensureTrailingNewline(info.reportMarkdown),
      };
    case "quiz":
    case "flashcards":
      if (!info.interactiveHtml) return null;
      return {
        ext: "html",
        mode: "text",
        content: ensureTrailingNewline(info.interactiveHtml),
      };
    case "data_table":
      if (!info.dataTable) return null;
      return {
        ext: "csv",
        mode: "text",
        content: toCsv(info.dataTable.headers, info.dataTable.rows),
      };
    case "mind_map":
      if (!info.mindMapContent) return null;
      return {
        ext: "json",
        mode: "text",
        content: ensureTrailingNewline(info.mindMapContent),
      };
    default:
      return null;
  }
}

function classifySkip(info: ArtifactDownloadInfo): SkippedArtifact["reason"] {
  if (info.artifactType === "unsupported") return "unsupported_type";
  if (info.status && !isReadyStatus(info.status)) return "not_ready";
  return "not_exportable";
}

async function writeTargetFile(targetPath: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
}

export class ArtifactDownloadService {
  public constructor(private readonly adapter: ArtifactDownloadAdapter) {}

  public async downloadArtifact(
    notebookId: string,
    artifactId: string,
    options: DownloadArtifactOptions = {},
  ): Promise<DownloadedArtifact> {
    const info = await this.adapter.getArtifactDownloadInfo(notebookId, artifactId);
    if (!info) {
      throw new Error(`artifactId=${artifactId} was not found.`);
    }
    if (info.artifactType === "unsupported") {
      throw new Error(`artifact type '${info.rawType}' is not supported for download.`);
    }

    const artifact = materializeArtifact(info, options.slideFormat ?? "pdf");
    if (!artifact) {
      const reason = classifySkip(info);
      if (reason === "not_ready") {
        throw new Error(`artifactId=${artifactId} is not ready yet.`);
      }
      throw new Error(`artifactId=${artifactId} is not exportable yet.`);
    }

    const targetPath = resolveSingleTargetPath(notebookId, info, artifact.ext, options.out);
    await this.persistArtifact(info, artifact, targetPath, options.progressFactory);
    return {
      artifactId: info.artifactId,
      artifactTitle: info.artifactTitle,
      artifactType: info.artifactType,
      path: targetPath,
    };
  }

  public async downloadAllArtifacts(
    notebookId: string,
    options: DownloadArtifactOptions = {},
  ): Promise<DownloadAllResult> {
    const artifacts = await this.adapter.listArtifacts(notebookId);
    const downloaded: DownloadedArtifact[] = [];
    const skipped: SkippedArtifact[] = [];
    const failed: SkippedArtifact[] = [];

    for (const artifact of artifacts) {
      const info = await this.adapter.getArtifactDownloadInfo(notebookId, artifact.id);
      if (!info) {
        skipped.push({
          artifactId: artifact.id,
          artifactTitle: artifact.title,
          artifactType: artifact.rawType,
          reason: "missing",
        });
        continue;
      }
      if (info.artifactType === "unsupported") {
        skipped.push({
          artifactId: info.artifactId,
          artifactTitle: info.artifactTitle,
          artifactType: info.rawType,
          reason: "unsupported_type",
        });
        continue;
      }

      const materialized = materializeArtifact(info, options.slideFormat ?? "pdf");
      if (!materialized) {
        skipped.push({
          artifactId: info.artifactId,
          artifactTitle: info.artifactTitle,
          artifactType: info.rawType,
          reason: classifySkip(info),
        });
        continue;
      }

      const targetPath = resolveBulkTargetPath(notebookId, info, materialized.ext, options.out);
      try {
        await this.persistArtifact(info, materialized, targetPath, options.progressFactory);
        downloaded.push({
          artifactId: info.artifactId,
          artifactTitle: info.artifactTitle,
          artifactType: info.artifactType,
          path: targetPath,
        });
      } catch (error) {
        failed.push({
          artifactId: info.artifactId,
          artifactTitle: info.artifactTitle,
          artifactType: info.rawType,
          reason: "download_failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { downloaded, skipped, failed };
  }

  private async persistArtifact(
    info: ArtifactDownloadInfo,
    artifact: MaterializedArtifact,
    targetPath: string,
    progressFactory?: (context: DownloadProgressContext) => BinaryProgressHandle,
  ): Promise<void> {
    if (artifact.mode === "text") {
      await writeTargetFile(targetPath, artifact.content ?? "");
      return;
    }

    const progress = progressFactory?.({
      artifactId: info.artifactId,
      artifactTitle: info.artifactTitle,
      artifactType: info.artifactType,
      targetPath,
    });
    try {
      const buffer = await this.adapter.downloadBinary(artifact.url ?? "", (state) => {
        progress?.update(state);
      });
      await writeTargetFile(targetPath, buffer);
    } finally {
      progress?.stop();
    }
  }
}
