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
