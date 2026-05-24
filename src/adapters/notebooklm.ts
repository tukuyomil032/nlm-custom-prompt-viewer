import type { ArtifactRecord, NotebookLmAdapter, SupportedArtifactType } from "../types.js";
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
  flashcards: "flashcards"
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getString(
  obj: UnknownRecord,
  ...keys: string[]
): string | undefined {
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

function ensureAuthFriendlyError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/(401|403|csrf|auth|cookie|session|login|unauth)/i.test(message)) {
    throw new Error(
      "NotebookLMの認証状態を確認してください。ブラウザの既存セッションを更新後、再実行してください（例: `nlm login` または NotebookLM に再ログイン）。"
    );
  }
  throw error instanceof Error ? error : new Error(message);
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
    "notebooklm-sdk のクライアント初期化に失敗しました。SDKバージョンと認証方式を確認してください。"
  );
}

function pickFirstArray(
  payload: unknown,
  paths: Array<(root: unknown) => unknown>
): unknown[] {
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
  const rawType = getString(item, "type", "artifactType", "artifact_type") ?? "unknown";

  if (!id) return null;

  return {
    id,
    title,
    rawType,
    type: normalizeType(rawType),
    raw: item
  };
}

export class NotebookLmSdkAdapter implements NotebookLmAdapter {
  private readonly clientPromise: Promise<unknown>;

  public constructor(client?: unknown) {
    this.clientPromise = client ? Promise.resolve(client) : createClientFromSdk();
  }

  public async listArtifacts(notebookId: string): Promise<ArtifactRecord[]> {
    try {
      const client = (await this.clientPromise) as UnknownRecord;
      const payload = await this.fetchArtifactsPayload(client, notebookId);
      const items = pickFirstArray(payload, [
        (root) => (isRecord(root) ? root.artifacts : undefined),
        (root) => (isRecord(root) && isRecord(root.studio) ? root.studio.artifacts : undefined),
        (root) => (isRecord(root) ? root.items : undefined),
        (root) => root
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
    artifact: Pick<ArtifactRecord, "id" | "title" | "rawType">
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

  private async fetchArtifactsPayload(
    client: UnknownRecord,
    notebookId: string
  ): Promise<unknown> {
    const candidates: Array<() => Promise<unknown>> = [];

    if (isRecord(client.studio) && typeof client.studio.status === "function") {
      const statusFn = (client.studio as { status: (id: string) => Promise<unknown> }).status;
      candidates.push(() => statusFn(notebookId));
    }
    if (typeof client.studioStatus === "function") {
      candidates.push(() => (client.studioStatus as (id: string) => Promise<unknown>)(notebookId));
    }
    if (isRecord(client.artifacts) && typeof client.artifacts.list === "function") {
      const listFn = (client.artifacts as { list: (id: string) => Promise<unknown> }).list;
      candidates.push(() => listFn(notebookId));
    }

    for (const run of candidates) {
      try {
        return await run();
      } catch {
        continue;
      }
    }
    throw new Error("Artifacts一覧APIを呼び出せませんでした。SDKの公開メソッド名が変更されている可能性があります。");
  }

  private async queryNotebook(
    client: UnknownRecord,
    notebookId: string,
    question: string
  ): Promise<string | null> {
    const candidates: Array<() => Promise<unknown>> = [];

    if (isRecord(client.notebooks) && typeof client.notebooks.query === "function") {
      const queryFn = (client.notebooks as {
        query: (id: string, question: string) => Promise<unknown>;
      }).query;
      candidates.push(() =>
        queryFn(notebookId, question)
      );
    }
    if (typeof client.query === "function") {
      candidates.push(() => (client.query as (id: string, q: string) => Promise<unknown>)(notebookId, question));
    }
    if (typeof client.ask === "function") {
      candidates.push(() =>
        (client.ask as (input: { notebookId: string; question: string }) => Promise<unknown>)({
          notebookId,
          question
        })
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
