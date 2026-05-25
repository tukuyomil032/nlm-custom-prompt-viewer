export const SUPPORTED_ARTIFACT_TYPES = [
  "slides",
  "video",
  "audio",
  "quiz",
  "flashcards",
  "report",
  "mind_map",
  "infographic",
  "data_table",
] as const;

export type SupportedArtifactType = (typeof SUPPORTED_ARTIFACT_TYPES)[number];
export type PromptMethod = "direct" | "qa_fallback";
export type PromptConfidence = "high" | "inferred";

export interface PromptInfo {
  text: string;
  method: PromptMethod;
  confidence: PromptConfidence;
}

export interface PromptResult {
  notebookId: string;
  artifactId: string;
  artifactType: SupportedArtifactType;
  artifactTitle: string;
  prompt: PromptInfo;
  retrievedAt: string;
  warnings: string[];
}

export interface ArtifactRecord {
  id: string;
  title: string;
  type: SupportedArtifactType | "unsupported";
  rawType: string;
  createdAt: string | null;
  status: string | null;
  raw: unknown;
}

export interface NotebookRecord {
  id: string;
  title: string;
  createdAt: string | null;
  raw: unknown;
}

export interface ListPromptOptions {
  type?: SupportedArtifactType;
  limit?: number;
  infer?: boolean;
}

export interface DataTableContent {
  headers: string[];
  rows: string[][];
}

export interface BinaryDownloadProgress {
  bytesTransferred: number;
  totalBytes: number | null;
}

export interface ArtifactDownloadInfo {
  notebookId: string;
  artifactId: string;
  artifactType: ArtifactRecord["type"];
  artifactTitle: string;
  rawType: string;
  status: string | null;
  audioUrl: string | null;
  videoUrl: string | null;
  slidePdfUrl: string | null;
  slidePptxUrl: string | null;
  infographicUrl: string | null;
  reportMarkdown: string | null;
  interactiveHtml: string | null;
  dataTable: DataTableContent | null;
  mindMapContent: string | null;
}

export interface NotebookLmAdapter {
  listNotebooks(): Promise<NotebookRecord[]>;
  listArtifacts(notebookId: string): Promise<ArtifactRecord[]>;
  askNotebookForPrompt(
    notebookId: string,
    artifact: Pick<ArtifactRecord, "id" | "title" | "rawType">,
  ): Promise<string | null>;
}

export interface ArtifactDownloadAdapter {
  listArtifacts(notebookId: string): Promise<ArtifactRecord[]>;
  getArtifactDownloadInfo(
    notebookId: string,
    artifactId: string,
  ): Promise<ArtifactDownloadInfo | null>;
  downloadBinary(
    url: string,
    onProgress?: (progress: BinaryDownloadProgress) => void,
  ): Promise<Buffer>;
}
