export const SUPPORTED_ARTIFACT_TYPES = ["slides", "video", "audio", "quiz", "flashcards"] as const;

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
  raw: unknown;
}

export interface ListPromptOptions {
  type?: SupportedArtifactType;
  limit?: number;
}

export interface NotebookLmAdapter {
  listArtifacts(notebookId: string): Promise<ArtifactRecord[]>;
  askNotebookForPrompt(
    notebookId: string,
    artifact: Pick<ArtifactRecord, "id" | "title" | "rawType">,
  ): Promise<string | null>;
}
