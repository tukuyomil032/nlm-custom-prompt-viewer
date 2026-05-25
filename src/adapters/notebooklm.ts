import type {
  ArtifactDownloadAdapter,
  ArtifactDownloadInfo,
  ArtifactRecord,
  BinaryDownloadProgress,
  DataTableContent,
  NotebookLmAdapter,
  NotebookRecord,
  SupportedArtifactType,
} from "../types.js";
import { resolveStoredSession } from "../auth/sessionStore.js";

type UnknownRecord = Record<string, unknown>;

const TYPE_ALIASES: Record<string, SupportedArtifactType> = {
  slides: "slides",
  slide_deck: "slides",
  slideshow: "slides",
  video: "video",
  video_overview: "video",
  audio: "audio",
  audio_overview: "audio",
  podcast: "audio",
  quiz: "quiz",
  flashcards: "flashcards",
  report: "report",
  mind_map: "mind_map",
  mindmap: "mind_map",
  infographic: "infographic",
  data_table: "data_table",
  datatable: "data_table",
  table: "data_table",
};

const TRUSTED_MEDIA_DOMAINS = [
  ".googleusercontent.com",
  ".googlevideo.com",
  ".gstatic.com",
  ".googleapis.com",
  ".usercontent.google.com",
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getString(obj: UnknownRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeType(rawType: string): SupportedArtifactType | "unsupported" {
  const lower = rawType.toLowerCase().replace(/\s+/g, "_");
  return TYPE_ALIASES[lower] ?? "unsupported";
}

function getDateString(obj: UnknownRecord, ...keys: string[]): string | null {
  const value = getString(obj, ...keys);
  return value ?? null;
}

function getStatusString(obj: UnknownRecord): string | null {
  return getString(obj, "status") ?? null;
}

function toDataTableContent(value: unknown): DataTableContent | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.headers) || !Array.isArray(value.rows)) return null;
  const headers = value.headers.filter((item): item is string => typeof item === "string");
  const rows = value.rows
    .filter(Array.isArray)
    .map((row) => row.filter((item): item is string => typeof item === "string"));
  return { headers, rows };
}

function findRawArtifactEntry(items: unknown[], artifactId: string): unknown[] | null {
  for (const item of items) {
    if (Array.isArray(item) && item[0] === artifactId) {
      return item;
    }
    if (isRecord(item)) {
      if (
        getString(item, "id", "artifactId", "artifact_id") === artifactId &&
        Array.isArray(item._raw)
      ) {
        return item._raw as unknown[];
      }
    }
  }
  return null;
}

function extractSlideDeckUrls(raw: unknown[] | null): { pdf: string | null; pptx: string | null } {
  if (!raw || !Array.isArray(raw[16])) {
    return { pdf: null, pptx: null };
  }
  const metadata = raw[16];
  return {
    pdf: Array.isArray(metadata) && typeof metadata[3] === "string" ? metadata[3] : null,
    pptx: Array.isArray(metadata) && typeof metadata[4] === "string" ? metadata[4] : null,
  };
}

function extractInfographicUrl(raw: unknown[] | null): string | null {
  if (!raw) return null;
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const item = raw[index];
    if (
      Array.isArray(item) &&
      Array.isArray(item[2]) &&
      Array.isArray(item[2][0]) &&
      Array.isArray(item[2][0][1]) &&
      typeof item[2][0][1][0] === "string" &&
      item[2][0][1][0].startsWith("http")
    ) {
      return item[2][0][1][0];
    }
  }
  return null;
}

function extractMindMapContent(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  return typeof raw.content === "string" ? raw.content : null;
}

function isTrustedMediaUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return TRUSTED_MEDIA_DOMAINS.some(
      (domain) => hostname === domain.slice(1) || hostname.endsWith(domain),
    );
  } catch {
    return false;
  }
}

function ensureAuthFriendlyError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/(401|403|csrf|auth|cookie|session|login|unauth)/i.test(message)) {
    throw new Error(
      "Authentication failed. Refresh your NotebookLM browser session and retry (`nlm auth login` or re-login in NotebookLM).",
    );
  }
  throw error instanceof Error ? error : new Error(message);
}

function getErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0]?.trim() || "unknown error";
}

async function createClientFromSdk(): Promise<unknown> {
  const sdk = (await import("notebooklm-sdk")) as UnknownRecord;
  const session = await resolveStoredSession();
  const connectOptions =
    session.cookiesObject !== null ? { cookiesObject: session.cookiesObject } : undefined;

  const notebookLmClient = sdk.NotebookLMClient;
  if (isRecord(notebookLmClient) || typeof notebookLmClient === "function") {
    const connect = (notebookLmClient as UnknownRecord).connect;
    if (typeof connect === "function") {
      return await (connect as (opts?: unknown) => Promise<unknown>)(connectOptions);
    }
  }

  if (typeof notebookLmClient === "function") {
    return new (notebookLmClient as new () => unknown)();
  }

  if (typeof sdk.default === "function") {
    return new (sdk.default as new () => unknown)();
  }

  throw new Error(
    "Failed to initialize notebooklm-sdk client. Check SDK version and authentication setup.",
  );
}

function pickFirstArray(payload: unknown, paths: Array<(root: unknown) => unknown>): unknown[] {
  for (const path of paths) {
    const value = path(payload);
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function toArtifactRecord(item: unknown): ArtifactRecord | null {
  if (!isRecord(item)) return null;

  const id = getString(item, "id", "artifactId", "artifact_id");
  const title = getString(item, "title", "name") ?? "Untitled Artifact";
  const rawType = getString(item, "type", "kind", "artifactType", "artifact_type") ?? "unknown";

  if (!id) return null;

  return {
    id,
    title,
    rawType,
    type: normalizeType(rawType),
    createdAt: getDateString(item, "createdAt", "created_at", "created", "timestamp"),
    status: getStatusString(item),
    raw: item,
  };
}

function toNotebookRecord(item: unknown): NotebookRecord | null {
  if (!isRecord(item)) return null;

  const id = getString(item, "id", "notebookId", "notebook_id");
  const title = getString(item, "title", "name") ?? "Untitled Notebook";
  if (!id) return null;

  return {
    id,
    title,
    createdAt: getDateString(item, "createdAt", "created_at", "created", "timestamp"),
    raw: item,
  };
}

export class NotebookLmSdkAdapter implements NotebookLmAdapter, ArtifactDownloadAdapter {
  private readonly clientPromise: Promise<unknown>;

  public constructor(client?: unknown) {
    this.clientPromise = client ? Promise.resolve(client) : createClientFromSdk();
  }

  public async listNotebooks(): Promise<NotebookRecord[]> {
    try {
      const client = (await this.clientPromise) as UnknownRecord;
      const payload = await this.fetchNotebooksPayload(client);
      const items = pickFirstArray(payload, [
        (root) => (isRecord(root) ? root.notebooks : undefined),
        (root) => (isRecord(root) ? root.items : undefined),
        (root) => (isRecord(root) ? root.data : undefined),
        (root) => root,
      ]);
      return items
        .map(toNotebookRecord)
        .filter((record): record is NotebookRecord => record !== null);
    } catch (error) {
      ensureAuthFriendlyError(error);
    }
  }

  public async listArtifacts(notebookId: string): Promise<ArtifactRecord[]> {
    try {
      const client = (await this.clientPromise) as UnknownRecord;
      const payload = await this.fetchArtifactsPayload(client, notebookId);
      const items = pickFirstArray(payload, [
        (root) => (isRecord(root) ? root.artifacts : undefined),
        (root) => (isRecord(root) && isRecord(root.studio) ? root.studio.artifacts : undefined),
        (root) => (isRecord(root) ? root.items : undefined),
        (root) => root,
      ]);
      const artifacts = items
        .map(toArtifactRecord)
        .filter((record): record is ArtifactRecord => record !== null);
      return await this.addMindMapNotesIfMissing(client, notebookId, artifacts);
    } catch (error) {
      ensureAuthFriendlyError(error);
    }
  }

  public async askNotebookForPrompt(
    notebookId: string,
    artifact: Pick<ArtifactRecord, "id" | "title" | "rawType">,
  ): Promise<string | null> {
    const question =
      "次のNotebookLM Studio成果物について、生成時に使われたカスタム指示文だけをそのまま返してください。該当が不明なら `UNKNOWN` のみ返してください。\n" +
      `artifactId: ${artifact.id}\n` +
      `title: ${artifact.title}\n` +
      `type: ${artifact.rawType}`;

    try {
      const client = (await this.clientPromise) as UnknownRecord;
      const answer = await this.queryNotebook(client, notebookId, question);
      if (!answer) return null;
      if (answer.trim().toUpperCase() === "UNKNOWN") return null;
      return answer.trim();
    } catch (error) {
      ensureAuthFriendlyError(error);
    }
  }

  public async getArtifactDownloadInfo(
    notebookId: string,
    artifactId: string,
  ): Promise<ArtifactDownloadInfo | null> {
    try {
      const client = (await this.clientPromise) as UnknownRecord;
      const artifacts = await this.listArtifacts(notebookId);
      const artifact = artifacts.find((item) => item.id === artifactId);
      if (!artifact) return null;

      const payload = await this.fetchArtifactsPayload(client, notebookId);
      const items = pickFirstArray(payload, [
        (root) => (isRecord(root) ? root.artifacts : undefined),
        (root) => (isRecord(root) && isRecord(root.studio) ? root.studio.artifacts : undefined),
        (root) => (isRecord(root) ? root.items : undefined),
        (root) => root,
      ]);
      const rawArtifact = findRawArtifactEntry(items, artifactId);

      let parsedArtifact: UnknownRecord | null = null;
      if (isRecord(client.artifacts) && typeof client.artifacts.get === "function") {
        try {
          const result = await (
            client.artifacts as {
              get: (nbId: string, artId: string) => Promise<unknown>;
            }
          ).get(notebookId, artifactId);
          if (isRecord(result)) {
            parsedArtifact = result;
          }
        } catch {
          parsedArtifact = null;
        }
      }

      let reportMarkdown: string | null = null;
      if (artifact.type === "report") {
        reportMarkdown =
          (parsedArtifact ? getString(parsedArtifact, "content") : undefined) ??
          extractMindMapContent(artifact.raw);
        if (
          reportMarkdown === null &&
          isRecord(client.artifacts) &&
          typeof client.artifacts.getReportMarkdown === "function"
        ) {
          reportMarkdown = await (
            client.artifacts as {
              getReportMarkdown: (nbId: string, artId: string) => Promise<string | null>;
            }
          ).getReportMarkdown(notebookId, artifactId);
        }
      }

      let interactiveHtml: string | null = null;
      if (
        (artifact.type === "quiz" || artifact.type === "flashcards") &&
        isRecord(client.artifacts) &&
        typeof client.artifacts.getInteractiveHtml === "function"
      ) {
        interactiveHtml = await (
          client.artifacts as {
            getInteractiveHtml: (nbId: string, artId: string) => Promise<string | null>;
          }
        ).getInteractiveHtml(notebookId, artifactId);
      }

      let dataTable: DataTableContent | null = null;
      if (
        artifact.type === "data_table" &&
        isRecord(client.artifacts) &&
        typeof client.artifacts.getDataTableContent === "function"
      ) {
        dataTable = toDataTableContent(
          await (
            client.artifacts as {
              getDataTableContent: (nbId: string, artId: string) => Promise<unknown>;
            }
          ).getDataTableContent(notebookId, artifactId),
        );
      }

      const slideDeckUrls = extractSlideDeckUrls(rawArtifact);

      return {
        notebookId,
        artifactId: artifact.id,
        artifactType: artifact.type,
        artifactTitle: artifact.title,
        rawType: artifact.rawType,
        status:
          artifact.status ??
          (parsedArtifact ? getStatusString(parsedArtifact) : null) ??
          (artifact.type === "mind_map" ? "completed" : null),
        audioUrl: parsedArtifact ? (getString(parsedArtifact, "audioUrl") ?? null) : null,
        videoUrl: parsedArtifact ? (getString(parsedArtifact, "videoUrl") ?? null) : null,
        slidePdfUrl: slideDeckUrls.pdf,
        slidePptxUrl: slideDeckUrls.pptx,
        infographicUrl: extractInfographicUrl(rawArtifact),
        reportMarkdown,
        interactiveHtml,
        dataTable,
        mindMapContent: artifact.type === "mind_map" ? extractMindMapContent(artifact.raw) : null,
      };
    } catch (error) {
      ensureAuthFriendlyError(error);
    }
  }

  public async downloadBinary(
    url: string,
    onProgress?: (progress: BinaryDownloadProgress) => void,
  ): Promise<Buffer> {
    try {
      const client = (await this.clientPromise) as UnknownRecord;
      const cookieHeader = this.resolveGoogleCookieHeader(client);
      return await this.fetchBinaryWithProgress(url, cookieHeader, onProgress);
    } catch (error) {
      ensureAuthFriendlyError(error);
    }
  }

  private async fetchArtifactsPayload(client: UnknownRecord, notebookId: string): Promise<unknown> {
    const candidates: Array<{ name: string; run: () => Promise<unknown> }> = [];

    if (isRecord(client.studio) && typeof client.studio.status === "function") {
      candidates.push({
        name: "studio.status",
        run: () =>
          (client.studio as { status: (id: string) => Promise<unknown> }).status(notebookId),
      });
    }
    if (typeof client.studioStatus === "function") {
      candidates.push({
        name: "studioStatus",
        run: () => (client.studioStatus as (id: string) => Promise<unknown>)(notebookId),
      });
    }
    if (isRecord(client.artifacts) && typeof client.artifacts.list === "function") {
      candidates.push({
        name: "artifacts.list",
        run: () =>
          (client.artifacts as { list: (id: string) => Promise<unknown> }).list(notebookId),
      });
    }

    const failures: string[] = [];
    for (const candidate of candidates) {
      try {
        return await candidate.run();
      } catch (error) {
        failures.push(`${candidate.name}: ${getErrorSummary(error)}`);
        continue;
      }
    }
    const detail = failures.length > 0 ? ` Tried: ${failures.join(" | ")}` : "";
    throw new Error(
      `Could not call artifact listing APIs. SDK method names may have changed.${detail}`,
    );
  }

  private async addMindMapNotesIfMissing(
    client: UnknownRecord,
    notebookId: string,
    artifacts: ArtifactRecord[],
  ): Promise<ArtifactRecord[]> {
    if (artifacts.some((artifact) => artifact.type === "mind_map")) {
      return artifacts;
    }
    if (!isRecord(client.notes) || typeof client.notes.listMindMaps !== "function") {
      return artifacts;
    }

    try {
      const notes = await (
        client.notes as { listMindMaps: (id: string) => Promise<unknown> }
      ).listMindMaps(notebookId);
      const noteItems = Array.isArray(notes) ? notes : [];
      const mindMaps = noteItems
        .map((note) =>
          toArtifactRecord(
            isRecord(note)
              ? {
                  ...note,
                  kind: "mind_map",
                  title: getString(note, "title") ?? "Untitled Mind Map",
                }
              : note,
          ),
        )
        .filter((record): record is ArtifactRecord => record !== null);
      const seenIds = new Set(artifacts.map((artifact) => artifact.id));
      return [
        ...artifacts,
        ...mindMaps.filter((artifact) => {
          if (seenIds.has(artifact.id)) return false;
          seenIds.add(artifact.id);
          return true;
        }),
      ];
    } catch {
      return artifacts;
    }
  }

  private async fetchNotebooksPayload(client: UnknownRecord): Promise<unknown> {
    const candidates: Array<{ name: string; run: () => Promise<unknown> }> = [];

    if (isRecord(client.notebooks) && typeof client.notebooks.list === "function") {
      candidates.push({
        name: "notebooks.list",
        run: () => (client.notebooks as { list: () => Promise<unknown> }).list(),
      });
    }
    if (typeof client.listNotebooks === "function") {
      candidates.push({
        name: "listNotebooks",
        run: () => (client.listNotebooks as () => Promise<unknown>)(),
      });
    }
    if (typeof client.list === "function") {
      candidates.push({
        name: "list",
        run: () => (client.list as () => Promise<unknown>)(),
      });
    }

    const failures: string[] = [];
    for (const candidate of candidates) {
      try {
        return await candidate.run();
      } catch (error) {
        failures.push(`${candidate.name}: ${getErrorSummary(error)}`);
        continue;
      }
    }
    const detail = failures.length > 0 ? ` Tried: ${failures.join(" | ")}` : "";
    throw new Error(
      `Could not call notebook listing APIs. SDK method names may have changed.${detail}`,
    );
  }

  private resolveGoogleCookieHeader(client: UnknownRecord): string {
    if (isRecord(client.auth)) {
      const googleCookieHeader = getString(client.auth, "googleCookieHeader", "cookieHeader");
      if (googleCookieHeader) return googleCookieHeader;
    }
    throw new Error(
      "Authenticated media download is unavailable because cookie headers are missing.",
    );
  }

  private async fetchBinaryWithProgress(
    url: string,
    cookieHeader: string,
    onProgress?: (progress: BinaryDownloadProgress) => void,
    maxRedirects = 10,
  ): Promise<Buffer> {
    let currentUrl = url;

    for (let redirectCount = 0; redirectCount < maxRedirects; redirectCount += 1) {
      if (!isTrustedMediaUrl(currentUrl)) {
        throw new Error(`Untrusted redirect target: ${new URL(currentUrl).hostname}`);
      }

      const response = await fetch(currentUrl, {
        headers: { Cookie: cookieHeader },
        redirect: "manual",
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Redirect with no Location header (status ${response.status})`);
        }
        currentUrl = location.startsWith("http") ? location : new URL(location, currentUrl).href;
        continue;
      }

      if (!response.ok) {
        throw new Error(`Media download failed: HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        throw new Error("Media download returned HTML; authentication cookies may be expired.");
      }

      const contentLength = response.headers.get("content-length");
      const totalBytes =
        contentLength && Number.isFinite(Number(contentLength)) ? Number(contentLength) : null;
      let bytesTransferred = 0;
      onProgress?.({ bytesTransferred, totalBytes });

      if (!response.body) {
        const buffer = Buffer.from(await response.arrayBuffer());
        onProgress?.({ bytesTransferred: buffer.length, totalBytes: buffer.length });
        return buffer;
      }

      const reader = response.body.getReader();
      const chunks: Buffer[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const chunk = Buffer.from(value);
        chunks.push(chunk);
        bytesTransferred += chunk.length;
        onProgress?.({ bytesTransferred, totalBytes });
      }

      return Buffer.concat(chunks, bytesTransferred);
    }

    throw new Error("Too many redirects fetching media URL");
  }

  private async queryNotebook(
    client: UnknownRecord,
    notebookId: string,
    question: string,
  ): Promise<string | null> {
    const candidates: Array<() => Promise<unknown>> = [];

    if (isRecord(client.notebooks) && typeof client.notebooks.query === "function") {
      candidates.push(() =>
        (
          client.notebooks as {
            query: (id: string, question: string) => Promise<unknown>;
          }
        ).query(notebookId, question),
      );
    }
    if (typeof client.query === "function") {
      candidates.push(() =>
        (client.query as (id: string, q: string) => Promise<unknown>)(notebookId, question),
      );
    }
    if (typeof client.ask === "function") {
      candidates.push(() =>
        (client.ask as (input: { notebookId: string; question: string }) => Promise<unknown>)({
          notebookId,
          question,
        }),
      );
    }
    if (isRecord(client.chat) && typeof client.chat.ask === "function") {
      candidates.push(() =>
        (
          client.chat as {
            ask: (id: string, question: string, opts?: unknown) => Promise<unknown>;
          }
        ).ask(notebookId, question),
      );
    }

    for (const run of candidates) {
      try {
        const payload = await run();
        const text = this.extractText(payload);
        if (text) return text;
      } catch {
        continue;
      }
    }
    return null;
  }

  private extractText(payload: unknown): string | null {
    if (typeof payload === "string") return payload;
    if (!isRecord(payload)) return null;

    const direct = getString(payload, "text", "answer", "response", "content");
    if (direct) return direct;

    if (Array.isArray(payload.messages)) {
      for (const message of payload.messages) {
        if (isRecord(message)) {
          const text = getString(message, "text", "content");
          if (text) return text;
        }
      }
    }

    return null;
  }
}
