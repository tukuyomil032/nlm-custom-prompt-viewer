import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadConfig,
  resetConfig,
  resolveConfigPath,
  saveConfig,
  setLanguage
} from "../src/config/store.js";
import { DEFAULT_CONFIG } from "../src/config/types.js";

describe("config store", () => {
  it("loads default when file is missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nlm-cfg-"));
    process.env.XDG_CONFIG_HOME = dir;
    await resetConfig();

    const loaded = await loadConfig();
    expect(loaded).toEqual(DEFAULT_CONFIG);
    await rm(dir, { recursive: true, force: true });
  });

  it("persists language changes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nlm-cfg-"));
    process.env.XDG_CONFIG_HOME = dir;
    await saveConfig(DEFAULT_CONFIG);
    const next = await setLanguage("ja");

    expect(next.language).toBe("ja");
    const loaded = await loadConfig();
    expect(loaded.language).toBe("ja");
    expect(resolveConfigPath().startsWith(dir)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
