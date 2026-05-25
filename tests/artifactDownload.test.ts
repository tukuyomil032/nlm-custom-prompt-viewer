import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ArtifactDownloadService,
  type BinaryProgressHandle,
} from "../src/services/artifactDownload.js";
import type {
  ArtifactDownloadAdapter,
  ArtifactDownloadInfo,
  ArtifactRecord,
  BinaryDownloadProgress,
} from "../src/types.js";

class MockDownloadAdapter implements ArtifactDownloadAdapter {
  public constructor(
    private readonly infoMap: Record<string, ArtifactDownloadInfo>,
    private readonly progressMap: Record<
      string,
      { totalBytes: number | null; chunks: number[]; output: Buffer }
    > = {},
  ) {}

  public async listArtifacts(_notebookId: string): Promise<ArtifactRecord[]> {
    return Object.values(this.infoMap).map((info) => ({
      id: info.artifactId,
      title: info.artifactTitle,
      type: info.artifactType,
      rawType: info.rawType,
      createdAt: null,
      status: info.status,
      raw: {},
    }));
  }

  public async getArtifactDownloadInfo(
    _notebookId: string,
    artifactId: string,
  ): Promise<ArtifactDownloadInfo | null> {
    return this.infoMap[artifactId] ?? null;
  }

  public async downloadBinary(
    url: string,
    onProgress?: (progress: BinaryDownloadProgress) => void,
  ): Promise<Buffer> {
    const fixture = this.progressMap[url];
    if (!fixture) {
      throw new Error(`missing fixture for ${url}`);
    }
    onProgress?.({ bytesTransferred: 0, totalBytes: fixture.totalBytes });
    let bytesTransferred = 0;
    for (const chunk of fixture.chunks) {
      bytesTransferred += chunk;
      onProgress?.({ bytesTransferred, totalBytes: fixture.totalBytes });
    }
    return fixture.output;
  }
}

function makeInfo(
  overrides: Partial<ArtifactDownloadInfo> &
    Pick<ArtifactDownloadInfo, "artifactId" | "artifactType">,
): ArtifactDownloadInfo {
  return {
    notebookId: overrides.notebookId ?? "nb-1",
    artifactId: overrides.artifactId,
    artifactType: overrides.artifactType,
    artifactTitle: overrides.artifactTitle ?? overrides.artifactId,
    rawType: overrides.rawType ?? overrides.artifactType,
    status: overrides.status ?? "completed",
    audioUrl: overrides.audioUrl ?? null,
    videoUrl: overrides.videoUrl ?? null,
    slidePdfUrl: overrides.slidePdfUrl ?? null,
    slidePptxUrl: overrides.slidePptxUrl ?? null,
    infographicUrl: overrides.infographicUrl ?? null,
    reportMarkdown: overrides.reportMarkdown ?? null,
    interactiveHtml: overrides.interactiveHtml ?? null,
    dataTable: overrides.dataTable ?? null,
    mindMapContent: overrides.mindMapContent ?? null,
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("ArtifactDownloadService", () => {
  it("downloads a report to the default notebook-scoped directory", async () => {
    const service = new ArtifactDownloadService(
      new MockDownloadAdapter({
        rep1: makeInfo({
          artifactId: "rep1",
          artifactType: "report",
          artifactTitle: "Weekly Brief",
          reportMarkdown: "# Brief\n\nHello",
        }),
      }),
    );

    const downloaded = await service.downloadArtifact("nb-1", "rep1");
    expect(downloaded.path).toContain(path.join("outputs", "downloads", "nb-1", "weekly-brief.md"));

    const raw = await readFile(downloaded.path, "utf8");
    expect(raw).toContain("# Brief");

    await rm(path.resolve(process.cwd(), "outputs", "downloads", "nb-1"), {
      recursive: true,
      force: true,
    });
  });

  it("downloads slides as pptx when requested and honors direct file --out", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nlmv-slides-"));
    tempDirs.push(dir);
    const target = path.join(dir, "deck.pptx");

    const service = new ArtifactDownloadService(
      new MockDownloadAdapter(
        {
          slide1: makeInfo({
            artifactId: "slide1",
            artifactType: "slides",
            slidePdfUrl: "unused-pdf",
            slidePptxUrl: "slides-pptx",
          }),
        },
        {
          "slides-pptx": {
            totalBytes: 4,
            chunks: [2, 2],
            output: Buffer.from("PPTX"),
          },
        },
      ),
    );

    const downloaded = await service.downloadArtifact("nb-1", "slide1", {
      out: target,
      slideFormat: "pptx",
    });
    expect(downloaded.path).toBe(target);
    expect(await readFile(target, "utf8")).toBe("PPTX");
  });

  it("summarizes downloaded and skipped artifacts in bulk mode", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nlmv-bulk-"));
    tempDirs.push(dir);

    const service = new ArtifactDownloadService(
      new MockDownloadAdapter(
        {
          vid1: makeInfo({
            artifactId: "vid1",
            artifactType: "video",
            artifactTitle: "Demo Video",
            videoUrl: "video-url",
          }),
          rep1: makeInfo({
            artifactId: "rep1",
            artifactType: "report",
            artifactTitle: "Study Guide",
            reportMarkdown: "hello",
          }),
          skip1: makeInfo({
            artifactId: "skip1",
            artifactType: "slides",
            artifactTitle: "Pending Deck",
            status: "processing",
          }),
          bad1: makeInfo({
            artifactId: "bad1",
            artifactType: "unsupported",
            rawType: "canvas",
            artifactTitle: "Canvas",
            status: null,
          }),
        },
        {
          "video-url": {
            totalBytes: 5,
            chunks: [2, 3],
            output: Buffer.from("video"),
          },
        },
      ),
    );

    const result = await service.downloadAllArtifacts("nb-1", { out: dir });
    expect(result.downloaded).toHaveLength(2);
    expect(result.skipped).toHaveLength(2);
    expect(result.failed).toHaveLength(0);

    const names = result.downloaded.map((item) => path.basename(item.path)).sort();
    expect(names).toEqual(["demo-video.mp4", "study-guide.md"]);
  });

  it("forwards exact progress updates when content length is known", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nlmv-progress-known-"));
    tempDirs.push(dir);
    const updates: BinaryDownloadProgress[] = [];
    let stopped = false;

    const service = new ArtifactDownloadService(
      new MockDownloadAdapter(
        {
          vid1: makeInfo({
            artifactId: "vid1",
            artifactType: "video",
            videoUrl: "video-url",
          }),
        },
        {
          "video-url": {
            totalBytes: 10,
            chunks: [4, 6],
            output: Buffer.from("0123456789"),
          },
        },
      ),
    );

    await service.downloadArtifact("nb-1", "vid1", {
      out: dir,
      progressFactory: (): BinaryProgressHandle => ({
        update(progress) {
          updates.push(progress);
        },
        stop() {
          stopped = true;
        },
      }),
    });

    expect(updates).toEqual([
      { bytesTransferred: 0, totalBytes: 10 },
      { bytesTransferred: 4, totalBytes: 10 },
      { bytesTransferred: 10, totalBytes: 10 },
    ]);
    expect(stopped).toBe(true);
  });

  it("keeps reporting bytes when content length is unknown", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nlmv-progress-unknown-"));
    tempDirs.push(dir);
    const updates: BinaryDownloadProgress[] = [];

    const service = new ArtifactDownloadService(
      new MockDownloadAdapter(
        {
          img1: makeInfo({
            artifactId: "img1",
            artifactType: "infographic",
            infographicUrl: "image-url",
          }),
        },
        {
          "image-url": {
            totalBytes: null,
            chunks: [3, 2],
            output: Buffer.from("12345"),
          },
        },
      ),
    );

    await service.downloadArtifact("nb-1", "img1", {
      out: dir,
      progressFactory: (): BinaryProgressHandle => ({
        update(progress) {
          updates.push(progress);
        },
        stop() {},
      }),
    });

    expect(updates).toEqual([
      { bytesTransferred: 0, totalBytes: null },
      { bytesTransferred: 3, totalBytes: null },
      { bytesTransferred: 5, totalBytes: null },
    ]);
  });
});
