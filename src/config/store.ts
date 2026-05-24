import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG, type AppConfig, type LanguageCode } from "./types.js";

function configRootDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim().length > 0) {
    return path.resolve(xdg, "nlm-prompt");
  }
  return path.resolve(homedir(), ".config", "nlm-prompt");
}

export function resolveConfigPath(): string {
  return path.join(configRootDir(), "config.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toLanguage(value: unknown): LanguageCode {
  return value === "ja" ? "ja" : "en";
}

function normalizeConfig(input: unknown): AppConfig {
  if (!isRecord(input)) return DEFAULT_CONFIG;

  const update = isRecord(input.updateCheck) ? input.updateCheck : {};
  return {
    language: toLanguage(input.language),
    updateCheck: {
      enabled:
        typeof update.enabled === "boolean"
          ? update.enabled
          : DEFAULT_CONFIG.updateCheck.enabled,
      lastCheckedAt:
        typeof update.lastCheckedAt === "string" ? update.lastCheckedAt : null,
      latestSeenVersion:
        typeof update.latestSeenVersion === "string"
          ? update.latestSeenVersion
          : null
    }
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const target = resolveConfigPath();
  try {
    const raw = await readFile(target, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const target = resolveConfigPath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function resetConfig(): Promise<void> {
  const target = resolveConfigPath();
  await rm(target, { force: true });
}

export async function setLanguage(language: LanguageCode): Promise<AppConfig> {
  const current = await loadConfig();
  const next: AppConfig = {
    ...current,
    language
  };
  await saveConfig(next);
  return next;
}
