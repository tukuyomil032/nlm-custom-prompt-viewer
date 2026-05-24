import { describe, expect, it } from "vitest";
import { NotebookLmSdkAdapter } from "../src/adapters/notebooklm.js";

describe("NotebookLmSdkAdapter", () => {
  it("preserves `this` for notebooks.list calls", async () => {
    const notebooksApi = {
      async list() {
        if (this !== notebooksApi) {
          throw new Error("lost this");
        }
        return [{ id: "nb1", title: "Notebook 1" }];
      },
    };
    const adapter = new NotebookLmSdkAdapter({ notebooks: notebooksApi });

    const notebooks = await adapter.listNotebooks();
    expect(notebooks).toHaveLength(1);
    expect(notebooks[0]?.id).toBe("nb1");
  });

  it("preserves `this` for artifacts.list calls", async () => {
    const artifactsApi = {
      async list(_notebookId: string) {
        if (this !== artifactsApi) {
          throw new Error("lost this");
        }
        return [{ id: "a1", title: "Artifact 1", type: "slides" }];
      },
    };
    const adapter = new NotebookLmSdkAdapter({ artifacts: artifactsApi });

    const artifacts = await adapter.listArtifacts("nb1");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.id).toBe("a1");
  });

  it("maps SDK `kind` field to supported artifact types", async () => {
    const adapter = new NotebookLmSdkAdapter({
      artifacts: {
        async list() {
          return [
            { id: "s1", title: "Slides", kind: "slide_deck" },
            { id: "v1", title: "Video", kind: "video" },
            { id: "a1", title: "Audio", kind: "audio" },
            { id: "q1", title: "Quiz", kind: "quiz" },
            { id: "f1", title: "Cards", kind: "flashcards" },
            { id: "r1", title: "Report", kind: "report" },
            { id: "m1", title: "Mind map", kind: "mind_map" },
            { id: "i1", title: "Infographic", kind: "infographic" },
            { id: "d1", title: "Data table", kind: "data_table" },
          ];
        },
      },
    });

    const artifacts = await adapter.listArtifacts("nb1");
    expect(artifacts.map((item) => item.type)).toEqual([
      "slides",
      "video",
      "audio",
      "quiz",
      "flashcards",
      "report",
      "mind_map",
      "infographic",
      "data_table",
    ]);
  });

  it("uses client.chat.ask fallback and reads `answer`", async () => {
    const adapter = new NotebookLmSdkAdapter({
      chat: {
        async ask() {
          return { answer: "Recovered prompt text." };
        },
      },
    });

    const answer = await adapter.askNotebookForPrompt("nb1", {
      id: "a1",
      title: "Artifact",
      rawType: "slide_deck",
    });
    expect(answer).toBe("Recovered prompt text.");
  });

  it("adds mind maps from notes API when artifacts API omits them", async () => {
    const adapter = new NotebookLmSdkAdapter({
      artifacts: {
        async list() {
          return [{ id: "r1", title: "Report", kind: "report" }];
        },
      },
      notes: {
        async listMindMaps() {
          return [{ id: "m1", title: "Map", content: '{"nodes":[]}', createdAt: null }];
        },
      },
    });

    const artifacts = await adapter.listArtifacts("nb1");
    expect(artifacts.map((artifact) => artifact.type)).toEqual(["report", "mind_map"]);
    expect(artifacts[1]?.title).toBe("Map");
  });

  it("does not call notes mind map fallback when artifacts already include mind maps", async () => {
    let calls = 0;
    const adapter = new NotebookLmSdkAdapter({
      artifacts: {
        async list() {
          return [{ id: "m1", title: "Map", kind: "mind_map" }];
        },
      },
      notes: {
        async listMindMaps() {
          calls += 1;
          return [];
        },
      },
    });

    const artifacts = await adapter.listArtifacts("nb1");
    expect(artifacts).toHaveLength(1);
    expect(calls).toBe(0);
  });

  it("returns summarized candidate failures for notebook listing", async () => {
    const adapter = new NotebookLmSdkAdapter({
      notebooks: {
        async list() {
          throw new Error("notebooks failed");
        },
      },
      async listNotebooks() {
        throw new Error("listNotebooks failed");
      },
      async list() {
        throw new Error("list failed");
      },
    });

    await expect(adapter.listNotebooks()).rejects.toThrow(/notebooks\.list: notebooks failed/);
    await expect(adapter.listNotebooks()).rejects.toThrow(/listNotebooks: listNotebooks failed/);
    await expect(adapter.listNotebooks()).rejects.toThrow(/list: list failed/);
  });
});
