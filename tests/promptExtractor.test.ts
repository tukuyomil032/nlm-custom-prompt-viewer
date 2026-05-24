import { describe, expect, it } from "vitest";
import { PromptExtractorService } from "../src/services/promptExtractor.js";
import type { ArtifactRecord, NotebookLmAdapter } from "../src/types.js";

function makeArtifact(
  overrides: Partial<ArtifactRecord> & { id: string; type: ArtifactRecord["type"] },
): ArtifactRecord {
  return {
    id: overrides.id,
    title: overrides.title ?? "title",
    type: overrides.type,
    rawType: overrides.rawType ?? overrides.type,
    createdAt: overrides.createdAt ?? null,
    raw: overrides.raw ?? {},
  };
}

class MockAdapter implements NotebookLmAdapter {
  public fallbackCalls = 0;

  public constructor(
    private readonly artifacts: ArtifactRecord[],
    private readonly fallbackMap: Record<string, string | null> = {},
  ) {}

  public async listArtifacts(): Promise<ArtifactRecord[]> {
    return this.artifacts;
  }

  public async listNotebooks(): Promise<never[]> {
    return [];
  }

  public async askNotebookForPrompt(
    _notebookId: string,
    artifact: Pick<ArtifactRecord, "id">,
  ): Promise<string | null> {
    this.fallbackCalls += 1;
    return this.fallbackMap[artifact.id] ?? null;
  }
}

describe("PromptExtractorService", () => {
  it("direct抽出で method=direct を返す", async () => {
    const adapter = new MockAdapter([
      makeArtifact({
        id: "a1",
        type: "slides",
        raw: { customPrompt: "Explain like I'm five." },
      }),
    ]);
    const service = new PromptExtractorService(adapter);
    const result = await service.getPrompt("nb1", "a1");

    expect(result.prompt.method).toBe("direct");
    expect(result.prompt.confidence).toBe("high");
    expect(result.prompt.text).toContain("Explain like I'm five");
  });

  it("direct失敗時に qa_fallback を返す", async () => {
    const adapter = new MockAdapter(
      [
        makeArtifact({
          id: "v1",
          type: "video",
          raw: { status: "ready" },
        }),
      ],
      { v1: "Use cinematic tone." },
    );
    const service = new PromptExtractorService(adapter);
    const result = await service.getPrompt("nb1", "v1");

    expect(result.prompt.method).toBe("qa_fallback");
    expect(result.prompt.confidence).toBe("inferred");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("listでStudio全タイプを対象にし、typeフィルタを適用できる", async () => {
    const adapter = new MockAdapter([
      makeArtifact({ id: "s1", type: "slides", raw: { custom_prompt: "A" } }),
      makeArtifact({ id: "q1", type: "quiz", raw: { instruction: "B" } }),
      makeArtifact({ id: "r1", type: "report", rawType: "report", raw: { prompt: "C" } }),
      makeArtifact({ id: "m1", type: "mind_map", rawType: "mind_map", raw: { prompt: "D" } }),
      makeArtifact({
        id: "i1",
        type: "infographic",
        rawType: "infographic",
        raw: { prompt: "E" },
      }),
      makeArtifact({
        id: "d1",
        type: "data_table",
        rawType: "data_table",
        raw: { prompt: "F" },
      }),
    ]);
    const service = new PromptExtractorService(adapter);

    const onlySlides = await service.listPrompts("nb1", { type: "slides" });
    expect(onlySlides).toHaveLength(1);
    expect(onlySlides[0].artifactType).toBe("slides");

    const allSupported = await service.listPrompts("nb1");
    expect(allSupported).toHaveLength(6);
  });

  it("listPromptsDetailed is fast by default and does not call qa_fallback", async () => {
    const adapter = new MockAdapter(
      [
        makeArtifact({ id: "s1", type: "slides", raw: { custom_prompt: "A" } }),
        makeArtifact({ id: "v1", type: "video", raw: { prompt: "B" } }),
        makeArtifact({ id: "a1", type: "audio", raw: { status: "ready" } }),
      ],
      {
        a1: null,
      },
    );
    const service = new PromptExtractorService(adapter);

    const detailed = await service.listPromptsDetailed("nb1");
    expect(detailed.results).toHaveLength(2);
    expect(detailed.failures).toHaveLength(1);
    expect(detailed.entries).toHaveLength(3);
    expect(adapter.fallbackCalls).toBe(0);
    expect(detailed.failures[0]).toMatchObject({
      artifactId: "a1",
      reason: "not_extracted",
    });
  });

  it("listPromptsDetailed calls qa_fallback when infer is enabled", async () => {
    const adapter = new MockAdapter(
      [makeArtifact({ id: "a1", type: "audio", raw: { status: "ready" } })],
      { a1: "Narrate this as an admissions guide." },
    );
    const service = new PromptExtractorService(adapter);

    const detailed = await service.listPromptsDetailed("nb1", { infer: true });
    expect(adapter.fallbackCalls).toBe(1);
    expect(detailed.results).toHaveLength(1);
    expect(detailed.results[0].prompt.method).toBe("qa_fallback");
    expect(detailed.entries[0].prompt?.prompt.text).toContain("admissions guide");
  });
});
