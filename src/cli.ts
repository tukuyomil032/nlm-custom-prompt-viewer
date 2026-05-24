import { cancel, confirm, isCancel, select, text } from "@clack/prompts";
import chalk from "chalk";
import { Command } from "commander";
import gradient from "gradient-string";
import { readFile } from "node:fs/promises";
import stringWidth from "string-width";
import { NotebookLmSdkAdapter } from "./adapters/notebooklm.js";
import {
  clearStoredSession,
  resolveStoredSession,
  storeSessionSecurely,
} from "./auth/sessionStore.js";
import { loadConfig, resetConfig, saveConfig, setLanguage } from "./config/store.js";
import { DEFAULT_CONFIG, type AppConfig, type LanguageCode } from "./config/types.js";
import { t } from "./i18n/messages.js";
import {
  PromptExtractorService,
  summarizePromptText,
  type PromptListEntry,
  type PromptListFailure,
} from "./services/promptExtractor.js";
import { savePromptResult, slugify, type SaveFormat } from "./services/saveOutput.js";
import {
  SUPPORTED_ARTIFACT_TYPES,
  type ArtifactRecord,
  type NotebookRecord,
  type SupportedArtifactType,
} from "./types.js";
import { checkForUpdates } from "./update/checker.js";

const COMPACT_BANNER = "nlm-cpv";
let hasPrintedBanner = false;

interface ListCommandOptions {
  json?: boolean;
  type?: string;
  limit?: string;
  infer?: boolean;
}

interface GetCommandOptions {
  json?: boolean;
  save?: boolean;
  format?: string;
  out?: string;
}

interface PackageMeta {
  name: string;
  version: string;
}

type OutputMode = "human" | "json";

interface PromptListInput {
  notebookId?: string;
  options: ListCommandOptions;
  optionalPrompt?: boolean;
}

interface PromptGetInput {
  notebookId?: string;
  artifactId?: string;
  options: GetCommandOptions;
  optionalPrompt?: boolean;
}

interface RuntimeDeps {
  adapter: NotebookLmSdkAdapter;
  service: PromptExtractorService;
}

async function loadPackageMeta(): Promise<PackageMeta> {
  const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const payload = JSON.parse(raw) as { name?: unknown; version?: unknown };
  return {
    name: typeof payload.name === "string" ? payload.name : "nlm-custom-prompt-viewer",
    version: typeof payload.version === "string" ? payload.version : "0.0.0",
  };
}

async function resolveLanguage(): Promise<LanguageCode> {
  const config = await loadConfig();
  return config.language;
}

function canPromptInteractively(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function toErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0]?.trim() || "unknown error";
}

function printCompactBannerOnce(): void {
  if (hasPrintedBanner) return;
  hasPrintedBanner = true;
  console.log(gradient.fruit(COMPACT_BANNER));
}

function parseType(language: LanguageCode, input?: string): SupportedArtifactType | undefined {
  if (!input) return undefined;
  if ((SUPPORTED_ARTIFACT_TYPES as readonly string[]).includes(input)) {
    return input as SupportedArtifactType;
  }
  throw new Error(
    t(language, "errors.unsupportedType", {
      value: input,
      supported: SUPPORTED_ARTIFACT_TYPES.join(", "),
    }),
  );
}

function parseFormat(language: LanguageCode, input?: string): SaveFormat | undefined {
  if (!input) return undefined;
  if (input === "json" || input === "md") return input;
  throw new Error(t(language, "errors.badFormat"));
}

function parseLimit(language: LanguageCode, value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(t(language, "errors.badLimit"));
  }
  return Math.floor(parsed);
}

function padCell(value: string, width: number): string {
  const gap = Math.max(0, width - stringWidth(value));
  return `${value}${" ".repeat(gap)}`;
}

function shortDate(value: string | null): string {
  if (!value) return "-";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toISOString().slice(0, 10);
}

export function clipToWidth(input: string, max = 60): string {
  if (stringWidth(input) <= max) return input;
  const text = input.trim();
  const suffix = "...";
  const target = Math.max(0, max - stringWidth(suffix));
  let output = "";
  for (const char of text) {
    if (stringWidth(output + char) > target) break;
    output += char;
  }
  return `${output}${suffix}`;
}

function clip(input: string, max = 60): string {
  return clipToWidth(input, max);
}

interface PromptTableRow {
  artifactId: string;
  artifactType: string;
  method: string;
  prompt: string;
  muted?: boolean;
}

function printPromptTable(language: LanguageCode, rows: PromptTableRow[]): void {
  const headers = [
    t(language, "prompt.field.artifactId"),
    t(language, "prompt.field.type"),
    t(language, "prompt.field.method"),
    t(language, "prompt.field.promptStatus"),
  ];

  const terminalWidth = Math.max(72, process.stdout.columns ?? 100);
  const idWidth = Math.min(18, Math.max(12, stringWidth(headers[0])));
  const typeWidth = Math.min(14, Math.max(11, stringWidth(headers[1])));
  const methodWidth = Math.min(24, Math.max(18, stringWidth(headers[2])));
  const promptWidth = Math.max(24, terminalWidth - idWidth - typeWidth - methodWidth - 6);
  const widths = [idWidth, typeWidth, methodWidth, promptWidth];

  const headerLine = [
    padCell(headers[0], widths[0]),
    padCell(headers[1], widths[1]),
    padCell(headers[2], widths[2]),
    padCell(headers[3], widths[3]),
  ].join("  ");
  console.log(chalk.bold(headerLine));
  console.log(chalk.dim("-".repeat(stringWidth(headerLine))));

  for (const row of rows) {
    const line = [
      padCell(clip(row.artifactId, widths[0]), widths[0]),
      padCell(clip(row.artifactType, widths[1]), widths[1]),
      padCell(clip(row.method, widths[2]), widths[2]),
      padCell(clip(row.prompt, widths[3]), widths[3]),
    ].join("  ");
    console.log(row.muted ? chalk.dim(line) : line);
  }
}

function printArtifactCatalog(language: LanguageCode, artifacts: ArtifactRecord[]): void {
  const headers = [
    t(language, "prompt.field.artifactId"),
    t(language, "prompt.field.title"),
    t(language, "prompt.field.type"),
    t(language, "prompt.field.createdAt"),
    t(language, "prompt.field.support"),
  ];
  const rows = artifacts.map((artifact) => ({
    id: clip(artifact.id, 16),
    title: clip(artifact.title, 36),
    type: clip(artifact.rawType, 14),
    createdAt: shortDate(artifact.createdAt),
    support:
      artifact.type === "unsupported"
        ? t(language, "prompt.artifact.unsupported")
        : t(language, "prompt.artifact.supported"),
  }));

  const widths = headers.map((header) => stringWidth(header));
  for (const row of rows) {
    widths[0] = Math.max(widths[0], stringWidth(row.id));
    widths[1] = Math.max(widths[1], stringWidth(row.title));
    widths[2] = Math.max(widths[2], stringWidth(row.type));
    widths[3] = Math.max(widths[3], stringWidth(row.createdAt));
    widths[4] = Math.max(widths[4], stringWidth(row.support));
  }

  const headerLine = [
    padCell(headers[0], widths[0]),
    padCell(headers[1], widths[1]),
    padCell(headers[2], widths[2]),
    padCell(headers[3], widths[3]),
    padCell(headers[4], widths[4]),
  ].join("  ");
  console.log(chalk.bold(headerLine));
  console.log(chalk.dim("-".repeat(stringWidth(headerLine))));
  for (const row of rows) {
    console.log(
      [
        padCell(row.id, widths[0]),
        padCell(row.title, widths[1]),
        padCell(row.type, widths[2]),
        padCell(row.createdAt, widths[3]),
        padCell(row.support, widths[4]),
      ].join("  "),
    );
  }
}

function noteLabel(note: NotebookRecord): string {
  return `${clip(note.title, 56)} (${note.id})`;
}

function artifactLabel(artifact: ArtifactRecord): string {
  return `[${artifact.rawType}] ${clip(artifact.title, 64)}`;
}

function failureReasonLabel(language: LanguageCode, reason: PromptListFailure["reason"]): string {
  if (reason === "unsupported_type") {
    return t(language, "prompt.list.failure.unsupportedType");
  }
  if (reason === "not_extracted") {
    return t(language, "prompt.list.failure.notExtracted");
  }
  return t(language, "prompt.list.failure.extractionFailed");
}

function printListFailures(language: LanguageCode, failures: PromptListFailure[]): void {
  if (failures.length === 0) return;
  console.warn(
    chalk.yellow(
      t(language, "prompt.list.partialSummary", {
        count: String(failures.length),
      }),
    ),
  );
  for (const failure of failures.slice(0, 5)) {
    console.warn(
      chalk.yellow(
        `- ${clip(failure.artifactId, 14)} [${clip(failure.artifactType, 12)}] ${failureReasonLabel(language, failure.reason)}`,
      ),
    );
  }
  if (failures.length > 5) {
    console.warn(chalk.yellow(t(language, "prompt.list.partialMore")));
  }
}

function promptListEntryToRow(language: LanguageCode, entry: PromptListEntry): PromptTableRow {
  if (entry.prompt) {
    return {
      artifactId: entry.artifactId,
      artifactType: entry.prompt.artifactType,
      method: `${entry.prompt.prompt.method}/${entry.prompt.prompt.confidence}`,
      prompt: summarizePromptText(entry.prompt.prompt.text),
    };
  }

  const reason = entry.failure
    ? failureReasonLabel(language, entry.failure.reason)
    : t(language, "prompt.list.failure.notExtracted");
  return {
    artifactId: entry.artifactId,
    artifactType: entry.artifactType,
    method: t(language, "prompt.list.status.noPrompt"),
    prompt: reason,
    muted: true,
  };
}

async function pickSelect<T extends string>(
  language: LanguageCode,
  message: string,
  options: Array<{ label: string; value: T; hint?: string }>,
  initialValue?: T,
): Promise<T | null> {
  const answer = await select({
    message,
    options: options as never,
    initialValue,
  });
  if (isCancel(answer)) {
    cancel(t(language, "common.canceled"));
    return null;
  }
  return answer as T;
}

async function pickText(
  language: LanguageCode,
  message: string,
  placeholder?: string,
): Promise<string | null> {
  const answer = await text({
    message,
    placeholder,
  });
  if (isCancel(answer)) {
    cancel(t(language, "common.canceled"));
    return null;
  }
  return String(answer).trim();
}

async function pickConfirm(language: LanguageCode, message: string): Promise<boolean | null> {
  const answer = await confirm({ message });
  if (isCancel(answer)) {
    cancel(t(language, "common.canceled"));
    return null;
  }
  return Boolean(answer);
}

async function pickLanguageInteractive(current: LanguageCode): Promise<LanguageCode | null> {
  const answer = await pickSelect<LanguageCode>(
    current,
    t(current, "config.language.prompt"),
    [
      { value: "en", label: "English (en)" },
      { value: "ja", label: "日本語 (ja)" },
    ],
    current,
  );
  return answer;
}

async function validateStoredSession(): Promise<{
  status: "valid" | "invalid" | "missing";
  source: "keychain" | "session_file" | "none";
  warnings: string[];
}> {
  const session = await resolveStoredSession();
  if (session.cookiesObject === null) {
    return {
      status: "missing",
      source: session.source,
      warnings: session.warnings,
    };
  }

  try {
    const auth = (await import("notebooklm-sdk/auth")) as {
      connect: (opts?: unknown) => Promise<unknown>;
    };
    await auth.connect({ cookiesObject: session.cookiesObject });
    return {
      status: "valid",
      source: session.source,
      warnings: session.warnings,
    };
  } catch {
    return {
      status: "invalid",
      source: session.source,
      warnings: session.warnings,
    };
  }
}

function createRuntimeDeps(): RuntimeDeps {
  const adapter = new NotebookLmSdkAdapter();
  const service = new PromptExtractorService(adapter);
  return { adapter, service };
}

async function resolveNotebookId(
  language: LanguageCode,
  adapter: NotebookLmSdkAdapter,
  provided?: string,
): Promise<string | null> {
  if (provided) return provided;
  if (!canPromptInteractively()) {
    throw new Error(t(language, "errors.requiredValue", { name: "notebookId" }));
  }

  let notebooks: NotebookRecord[] = [];
  try {
    notebooks = await adapter.listNotebooks();
  } catch (error) {
    console.warn(
      chalk.yellow(
        t(language, "prompt.fallback.notebookFetchFailed", {
          reason: toErrorMessage(error),
        }),
      ),
    );
    const manualNotebookId = await pickText(
      language,
      t(language, "prompt.fallback.manualNotebookId"),
      "notebook-id",
    );
    if (manualNotebookId === null) return null;
    if (!manualNotebookId) {
      throw new Error(t(language, "errors.requiredValue", { name: "notebookId" }));
    }
    return manualNotebookId;
  }
  if (notebooks.length === 0) {
    throw new Error(t(language, "prompt.notebook.none"));
  }

  const selected = await pickSelect(
    language,
    t(language, "prompt.select.notebook"),
    notebooks.map((note) => ({
      value: note.id,
      label: noteLabel(note),
      hint: shortDate(note.createdAt),
    })),
  );
  return selected;
}

async function resolveArtifactId(
  language: LanguageCode,
  adapter: NotebookLmSdkAdapter,
  notebookId: string,
  provided?: string,
): Promise<string | null> {
  if (provided) return provided;
  if (!canPromptInteractively()) {
    throw new Error(t(language, "errors.requiredValue", { name: "artifactId" }));
  }

  let artifacts: ArtifactRecord[] = [];
  try {
    artifacts = await adapter.listArtifacts(notebookId);
  } catch (error) {
    console.warn(
      chalk.yellow(
        t(language, "prompt.fallback.artifactFetchFailed", {
          reason: toErrorMessage(error),
        }),
      ),
    );
    const manualArtifactId = await pickText(
      language,
      t(language, "prompt.fallback.manualArtifactId"),
      "artifact-id",
    );
    if (manualArtifactId === null) return null;
    if (!manualArtifactId) {
      throw new Error(t(language, "errors.requiredValue", { name: "artifactId" }));
    }
    return manualArtifactId;
  }
  if (artifacts.length === 0) {
    throw new Error(t(language, "prompt.artifact.none"));
  }

  printArtifactCatalog(language, artifacts);

  const supported = artifacts.filter((artifact) => artifact.type !== "unsupported");
  const unsupportedCount = artifacts.length - supported.length;
  if (unsupportedCount > 0) {
    console.warn(chalk.yellow(t(language, "prompt.artifact.unsupportedWarning")));
  }
  if (supported.length === 0) {
    throw new Error(t(language, "prompt.empty"));
  }

  const selected = await pickSelect(
    language,
    t(language, "prompt.select.artifact"),
    supported.map((artifact) => ({
      value: artifact.id,
      label: artifactLabel(artifact),
      hint: `${shortDate(artifact.createdAt)} / ${artifact.id}`,
    })),
  );
  return selected;
}

async function resolveListTypeInteractive(
  language: LanguageCode,
  current?: string,
): Promise<SupportedArtifactType | undefined | null> {
  if (current) return parseType(language, current);
  if (!canPromptInteractively()) return undefined;

  const selected = await pickSelect(
    language,
    t(language, "prompt.select.type"),
    [
      { value: "all", label: t(language, "prompt.type.all") },
      ...SUPPORTED_ARTIFACT_TYPES.map((value) => ({ value, label: value })),
    ],
    "all",
  );
  if (selected === null) return null;
  if (selected === "all") return undefined;
  return selected as SupportedArtifactType;
}

async function resolveListLimitInteractive(
  language: LanguageCode,
  current?: string,
): Promise<number | undefined | null> {
  if (current) return parseLimit(language, current);
  if (!canPromptInteractively()) return undefined;
  const input = await pickText(language, t(language, "prompt.select.limit"), "10");
  if (input === null) return null;
  if (!input) return undefined;
  return parseLimit(language, input);
}

async function resolveOutputMode(
  language: LanguageCode,
  options: GetCommandOptions,
): Promise<OutputMode | null> {
  if (options.json) return "json";
  if (!canPromptInteractively()) return "human";

  const selected = await pickSelect(
    language,
    t(language, "prompt.select.mode"),
    [
      { value: "human", label: t(language, "prompt.mode.human") },
      { value: "json", label: t(language, "prompt.mode.json") },
    ],
    "human",
  );
  return selected as OutputMode | null;
}

async function resolveSaveOptions(
  language: LanguageCode,
  options: GetCommandOptions,
  optionalPrompt: boolean,
  defaultOut?: string,
): Promise<{ shouldSave: boolean; format?: SaveFormat; out?: string } | null> {
  if (options.save) {
    return {
      shouldSave: true,
      format: parseFormat(language, options.format),
      out: options.out,
    };
  }

  if (!optionalPrompt || !canPromptInteractively()) {
    return { shouldSave: false };
  }

  const shouldSave = await pickConfirm(language, t(language, "prompt.select.save"));
  if (shouldSave === null) return null;
  if (!shouldSave) return { shouldSave: false };

  const formatChoice = await pickSelect(
    language,
    t(language, "prompt.select.format"),
    [
      { value: "both", label: "json + md" },
      { value: "json", label: "json" },
      { value: "md", label: "md" },
    ],
    "both",
  );
  if (formatChoice === null) return null;

  const out = await pickText(language, t(language, "prompt.select.out"), defaultOut);
  if (out === null) return null;
  return {
    shouldSave: true,
    format: formatChoice === "both" ? undefined : (formatChoice as SaveFormat),
    out: out || undefined,
  };
}

async function runPromptList(language: LanguageCode, deps: RuntimeDeps, input: PromptListInput) {
  const notebookId = await resolveNotebookId(language, deps.adapter, input.notebookId);
  if (!notebookId) return;

  let type = parseType(language, input.options.type);
  let limit = parseLimit(language, input.options.limit);
  if (input.optionalPrompt && !input.options.type) {
    const maybeType = await resolveListTypeInteractive(language);
    if (maybeType === null) return;
    type = maybeType;
  }
  if (input.optionalPrompt && !input.options.limit) {
    const maybeLimit = await resolveListLimitInteractive(language);
    if (maybeLimit === null) return;
    limit = maybeLimit;
  }

  if (input.options.json) {
    const results = await deps.service.listPrompts(notebookId, {
      type,
      limit,
      infer: input.options.infer,
    });
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (input.options.infer) {
    console.log(chalk.dim(t(language, "prompt.list.inferNotice")));
  }

  const detailed = await deps.service.listPromptsDetailed(notebookId, {
    type,
    limit,
    infer: input.options.infer,
  });
  const rows = detailed.entries.map((entry) => promptListEntryToRow(language, entry));

  if (rows.length === 0) {
    console.log(t(language, "prompt.empty"));
    return;
  }

  console.log(gradient.pastel(t(language, "prompt.list.title")));
  printPromptTable(language, rows);
  printListFailures(language, detailed.failures);
}

async function runPromptGet(language: LanguageCode, deps: RuntimeDeps, input: PromptGetInput) {
  const notebookId = await resolveNotebookId(language, deps.adapter, input.notebookId);
  if (!notebookId) return;
  const artifactId = await resolveArtifactId(language, deps.adapter, notebookId, input.artifactId);
  if (!artifactId) return;

  const outputMode =
    input.optionalPrompt && !input.options.json
      ? await resolveOutputMode(language, input.options)
      : "human";
  if (outputMode === null) return;
  const result = await deps.service.getPrompt(notebookId, artifactId);

  if (outputMode === "json" || input.options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(chalk.cyan(`${t(language, "prompt.field.artifactId")}: ${result.artifactId}`));
    console.log(`${t(language, "prompt.field.type")}: ${result.artifactType}`);
    console.log(
      `${t(language, "prompt.field.method")}: ${result.prompt.method} (${result.prompt.confidence})`,
    );
    console.log(chalk.bold.green(`${t(language, "prompt.field.prompt")}:`));
    console.log(result.prompt.text);
    if (result.warnings.length > 0) {
      console.log(`${t(language, "prompt.field.warnings")}: ${result.warnings.join(" | ")}`);
    }
  }

  const ext = input.options.format === "json" ? "json" : "md";
  const defaultOut = `./outputs/${slugify(result.artifactTitle) || result.artifactId}.${ext}`;
  const saveOptions = await resolveSaveOptions(
    language,
    input.options,
    Boolean(input.optionalPrompt),
    defaultOut,
  );
  if (!saveOptions || !saveOptions.shouldSave) return;

  const written = await savePromptResult(result, {
    format: saveOptions.format,
    out: saveOptions.out,
  });
  for (const target of written) {
    console.log(`${t(language, "prompt.saved")}: ${target}`);
  }
}

async function runConfigGet(language: LanguageCode, key?: string): Promise<void> {
  const current = await loadConfig();
  if (!key) {
    console.log(`${t(language, "config.current")}:`);
    console.log(JSON.stringify(current, null, 2));
    return;
  }

  if (key === "language") {
    console.log(current.language);
    return;
  }
  throw new Error(t(language, "config.key.unknown", { key }));
}

async function runConfigSet(language: LanguageCode, key?: string, value?: string): Promise<void> {
  let nextKey = key;
  if (!nextKey) {
    if (!canPromptInteractively()) {
      throw new Error(t(language, "errors.requiredValue", { name: "key" }));
    }
    const chosen = await pickSelect(language, t(language, "config.select.key"), [
      { value: "language", label: "language" },
    ]);
    if (!chosen) return;
    nextKey = chosen;
  }

  if (nextKey !== "language") {
    throw new Error(t(language, "config.key.unknown", { key: nextKey }));
  }

  let nextLanguage: LanguageCode | null = null;
  if (!value) {
    nextLanguage = await pickLanguageInteractive(language);
  } else if (value === "en" || value === "ja") {
    nextLanguage = value;
  } else {
    throw new Error(t(language, "config.value.invalidLanguage", { value }));
  }
  if (!nextLanguage) return;

  const next = await setLanguage(nextLanguage);
  console.log(
    t(next.language, "config.language.changed", {
      value: next.language,
    }),
  );
}

async function runConfigReset(language: LanguageCode, interactiveConfirm = false): Promise<void> {
  if (interactiveConfirm && canPromptInteractively()) {
    const ok = await pickConfirm(language, t(language, "config.command.reset"));
    if (!ok) return;
  }
  await resetConfig();
  await saveConfig(DEFAULT_CONFIG satisfies AppConfig);
  console.log(t(language, "config.reset"));
}

async function runAuthStatus(): Promise<void> {
  const config = await loadConfig();
  const language = config.language;
  const result = await validateStoredSession();

  const nextConfig: AppConfig = {
    ...config,
    auth: {
      lastValidatedAt: new Date().toISOString(),
      lastSource: result.source,
      lastStatus: result.status,
    },
  };
  await saveConfig(nextConfig);

  if (result.status === "valid") {
    console.log(
      t(language, "auth.status.valid", {
        source: result.source,
      }),
    );
  } else if (result.status === "missing") {
    console.log(t(language, "auth.status.missing"));
  } else {
    console.log(t(language, "auth.status.invalid"));
  }

  for (const warning of result.warnings) {
    console.warn(warning);
  }
}

async function runAuthLogin(): Promise<void> {
  const config = await loadConfig();
  const language = config.language;
  console.log(t(language, "auth.login.start"));

  const sdkAuth = (await import("notebooklm-sdk/auth")) as {
    login: (opts?: unknown) => Promise<{ storageState: unknown }>;
  };
  const logged = await sdkAuth.login();
  await storeSessionSecurely(logged.storageState);

  const status = await validateStoredSession();
  await saveConfig({
    ...config,
    auth: {
      lastValidatedAt: new Date().toISOString(),
      lastSource: status.source,
      lastStatus: status.status,
    },
  });
  console.log(t(language, "auth.login.done"));
}

async function runAuthLogout(): Promise<void> {
  const config = await loadConfig();
  const language = config.language;
  await clearStoredSession();
  await saveConfig({
    ...config,
    auth: {
      lastValidatedAt: new Date().toISOString(),
      lastSource: "none",
      lastStatus: "missing",
    },
  });
  console.log(t(language, "auth.logout.done"));
}

async function runUpdateCheck(): Promise<void> {
  const config = await loadConfig();
  const language = config.language;
  const pkg = await loadPackageMeta();
  const result = await checkForUpdates({
    packageName: pkg.name,
    currentVersion: pkg.version,
    config,
    force: true,
  });
  await saveConfig(result.nextConfig);

  if (!result.latestVersion) {
    console.log(t(language, "update.unreachable"));
    return;
  }
  if (result.hasUpdate) {
    console.log(
      chalk.yellow(
        t(language, "update.available", {
          current: pkg.version,
          latest: result.latestVersion,
          pkg: pkg.name,
        }),
      ),
    );
    return;
  }
  console.log(
    t(language, "update.latest", {
      current: pkg.version,
    }),
  );
}

async function runPromptMenu(language: LanguageCode, deps: RuntimeDeps): Promise<void> {
  if (!canPromptInteractively()) {
    throw new Error(t(language, "errors.requiredValue", { name: "prompt subcommand" }));
  }
  const picked = await pickSelect(
    language,
    t(language, "prompt.command.select"),
    [
      { value: "list", label: t(language, "prompt.command.list") },
      { value: "get", label: t(language, "prompt.command.get") },
    ],
    "list",
  );
  if (!picked) return;

  if (picked === "list") {
    await runPromptList(language, deps, {
      options: {},
      optionalPrompt: true,
    });
    return;
  }
  await runPromptGet(language, deps, {
    options: {},
    optionalPrompt: true,
  });
}

async function runConfigMenu(language: LanguageCode): Promise<void> {
  if (!canPromptInteractively()) {
    throw new Error(t(language, "errors.requiredValue", { name: "config subcommand" }));
  }
  const picked = await pickSelect(
    language,
    t(language, "config.command.select"),
    [
      { value: "get", label: t(language, "config.command.get") },
      { value: "set", label: t(language, "config.command.set") },
      { value: "reset", label: t(language, "config.command.reset") },
    ],
    "get",
  );
  if (!picked) return;
  if (picked === "get") {
    await runConfigGet(language);
    return;
  }
  if (picked === "set") {
    await runConfigSet(language);
    return;
  }
  await runConfigReset(language, true);
}

async function runAuthMenu(language: LanguageCode): Promise<void> {
  if (!canPromptInteractively()) {
    throw new Error(t(language, "errors.requiredValue", { name: "auth subcommand" }));
  }
  const picked = await pickSelect(
    language,
    t(language, "auth.command.select"),
    [
      { value: "status", label: t(language, "auth.command.status") },
      { value: "login", label: t(language, "auth.command.login") },
      { value: "logout", label: t(language, "auth.command.logout") },
    ],
    "status",
  );
  if (!picked) return;
  if (picked === "status") return runAuthStatus();
  if (picked === "login") return runAuthLogin();
  return runAuthLogout();
}

async function runUpdateMenu(language: LanguageCode): Promise<void> {
  if (!canPromptInteractively()) {
    throw new Error(t(language, "errors.requiredValue", { name: "update subcommand" }));
  }
  const picked = await pickSelect(
    language,
    t(language, "update.command.select"),
    [{ value: "check", label: t(language, "update.command.check") }],
    "check",
  );
  if (!picked) return;
  await runUpdateCheck();
}

async function runRootMenu(language: LanguageCode): Promise<void> {
  if (canPromptInteractively()) {
    printCompactBannerOnce();
  }
  const picked = await pickSelect(
    language,
    t(language, "cli.menu.message"),
    [
      { value: "prompt", label: t(language, "cli.menu.prompt") },
      { value: "config", label: t(language, "cli.menu.config") },
      { value: "auth", label: t(language, "cli.menu.auth") },
      { value: "update", label: t(language, "cli.menu.update") },
      { value: "exit", label: t(language, "cli.menu.exit") },
    ],
    "prompt",
  );
  if (!picked || picked === "exit") return;

  const deps = createRuntimeDeps();
  if (picked === "prompt") return runPromptMenu(language, deps);
  if (picked === "config") return runConfigMenu(language);
  if (picked === "auth") return runAuthMenu(language);
  return runUpdateMenu(language);
}

function createPromptCommand(language: LanguageCode): Command {
  const prompt = new Command("prompt");
  prompt.description(t(language, "prompt.description"));
  prompt.addHelpText(
    "after",
    `\n${t(language, "prompt.list.help")}\n\n${t(language, "prompt.get.help")}`,
  );

  prompt.action(async () => {
    const deps = createRuntimeDeps();
    await runPromptMenu(language, deps);
  });

  prompt
    .command("list")
    .description(t(language, "prompt.command.list"))
    .argument("[notebookId]", "NotebookLM notebook id")
    .option("--type <artifactType>", "Filter type")
    .option("--json", "Output strict JSON")
    .option("--limit <n>", "Limit result count")
    .option("--infer", "Run slower Notebook Q&A fallback inference")
    .addHelpText("after", `\n${t(language, "prompt.list.help")}`)
    .action(async (notebookId: string | undefined, options: ListCommandOptions) => {
      const deps = createRuntimeDeps();
      const optionalPrompt = !options.type && !options.limit && !options.json;
      await runPromptList(language, deps, {
        notebookId,
        options,
        optionalPrompt,
      });
    });

  prompt
    .command("get")
    .description(t(language, "prompt.command.get"))
    .argument("[notebookId]", "NotebookLM notebook id")
    .argument("[artifactId]", "Studio artifact id")
    .option("--json", "Output strict JSON")
    .option("--save", "Save output files")
    .option("--format <format>", "Save format: json|md")
    .option("--out <path>", "Output file or directory path")
    .addHelpText("after", `\n${t(language, "prompt.get.help")}`)
    .action(
      async (
        notebookId: string | undefined,
        artifactId: string | undefined,
        options: GetCommandOptions,
      ) => {
        const deps = createRuntimeDeps();
        const optionalPrompt = !options.json && !options.save && !options.format && !options.out;
        await runPromptGet(language, deps, {
          notebookId,
          artifactId,
          options,
          optionalPrompt,
        });
      },
    );

  return prompt;
}

function createConfigCommand(language: LanguageCode): Command {
  const config = new Command("config");
  config.description(t(language, "config.description"));
  config.addHelpText("after", `\n${t(language, "config.help")}`);

  config.action(async () => {
    await runConfigMenu(language);
  });

  config
    .command("get")
    .description(t(language, "config.command.get"))
    .argument("[key]", "Config key")
    .action(async (key?: string) => {
      await runConfigGet(language, key);
    });

  config
    .command("set")
    .description(t(language, "config.command.set"))
    .argument("[key]", "Config key")
    .argument("[value]", "Config value")
    .action(async (key?: string, value?: string) => {
      await runConfigSet(language, key, value);
    });

  config
    .command("reset")
    .description(t(language, "config.command.reset"))
    .action(async () => {
      await runConfigReset(language, false);
    });

  return config;
}

function createAuthCommand(language: LanguageCode): Command {
  const auth = new Command("auth");
  auth.description(t(language, "auth.description"));
  auth.addHelpText("after", `\n${t(language, "auth.help")}`);

  auth.action(async () => {
    await runAuthMenu(language);
  });

  auth
    .command("status")
    .description(t(language, "auth.command.status"))
    .action(async () => {
      await runAuthStatus();
    });

  auth
    .command("login")
    .description(t(language, "auth.command.login"))
    .action(async () => {
      await runAuthLogin();
    });

  auth
    .command("logout")
    .description(t(language, "auth.command.logout"))
    .action(async () => {
      await runAuthLogout();
    });

  return auth;
}

function createUpdateCommand(language: LanguageCode): Command {
  const update = new Command("update");
  update.description(t(language, "update.description"));
  update.addHelpText("after", `\n${t(language, "update.help")}`);

  update.action(async () => {
    await runUpdateMenu(language);
  });

  update
    .command("check")
    .description(t(language, "update.command.check"))
    .action(async () => {
      await runUpdateCheck();
    });

  return update;
}

async function maybeRunStartupUpdateCheck(argv: string[]): Promise<void> {
  if (argv.includes("--json")) return;

  const config = await loadConfig();
  if (!config.updateCheck.enabled) return;

  const language = config.language;
  const pkg = await loadPackageMeta();
  const result = await checkForUpdates({
    packageName: pkg.name,
    currentVersion: pkg.version,
    config,
    force: false,
  });

  if (!result.checked) return;
  await saveConfig(result.nextConfig);

  if (!result.latestVersion) return;
  if (!result.hasUpdate) return;

  console.error(
    chalk.yellow(
      t(language, "update.available", {
        current: pkg.version,
        latest: result.latestVersion,
        pkg: pkg.name,
      }),
    ),
  );
}

export function createProgram(language: LanguageCode): Command {
  const program = new Command("nlm");
  program
    .description(t(language, "cli.description"))
    .showHelpAfterError(t(language, "cli.help.afterError"))
    .addHelpText("after", `\n${t(language, "cli.help.footer")}`);

  program.addCommand(createPromptCommand(language));
  program.addCommand(createConfigCommand(language));
  program.addCommand(createAuthCommand(language));
  program.addCommand(createUpdateCommand(language));
  return program;
}

export async function runCli(argv: string[]): Promise<number> {
  void maybeRunStartupUpdateCheck(argv).catch(() => {
    // Do not block command execution for background update checks.
  });

  const language = await resolveLanguage();
  if (argv.length === 0) {
    if (canPromptInteractively()) {
      await runRootMenu(language);
      return 0;
    }
    createProgram(language).outputHelp();
    return 0;
  }

  const program = createProgram(language);
  await program.parseAsync(argv, { from: "user" });
  return 0;
}
