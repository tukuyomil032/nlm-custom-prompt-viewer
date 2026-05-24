import type {
  ArtifactRecord,
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
};

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

export class NotebookLmSdkAdapter implements NotebookLmAdapter {
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
      return items
        .map(toArtifactRecord)
        .filter((record): record is ArtifactRecord => record !== null);
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
