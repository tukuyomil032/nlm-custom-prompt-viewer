import { cancel, isCancel, select } from "@clack/prompts";
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { NotebookLmSdkAdapter } from "./adapters/notebooklm.js";
import {
  clearStoredSession,
  resolveStoredSession,
  storeSessionSecurely
} from "./auth/sessionStore.js";
import {
  loadConfig,
  resetConfig,
  saveConfig,
  setLanguage
} from "./config/store.js";
import { DEFAULT_CONFIG, type AppConfig, type LanguageCode } from "./config/types.js";
import { t } from "./i18n/messages.js";
import { formatListRow, PromptExtractorService } from "./services/promptExtractor.js";
import { savePromptResult, type SaveFormat } from "./services/saveOutput.js";
import {
  SUPPORTED_ARTIFACT_TYPES,
  type SupportedArtifactType
} from "./types.js";
import { checkForUpdates } from "./update/checker.js";

interface ListCommandOptions {
  json?: boolean;
  type?: string;
  limit?: string;
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

async function loadPackageMeta(): Promise<PackageMeta> {
  const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const payload = JSON.parse(raw) as { name?: unknown; version?: unknown };
  return {
    name: typeof payload.name === "string" ? payload.name : "nlm-custom-prompt-viewer",
    version: typeof payload.version === "string" ? payload.version : "0.0.0"
  };
}

async function resolveLanguage(): Promise<LanguageCode> {
  const config = await loadConfig();
  return config.language;
}

function parseType(
  language: LanguageCode,
  input?: string
): SupportedArtifactType | undefined {
  if (!input) return undefined;
  if ((SUPPORTED_ARTIFACT_TYPES as readonly string[]).includes(input)) {
    return input as SupportedArtifactType;
  }
  throw new Error(
    t(language, "errors.unsupportedType", {
      value: input,
      supported: SUPPORTED_ARTIFACT_TYPES.join(", ")
    })
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

async function pickLanguageInteractive(current: LanguageCode): Promise<LanguageCode> {
  const answer = await select({
    message: t(current, "config.language.prompt"),
    options: [
      { value: "en", label: "English (en)" },
      { value: "ja", label: "日本語 (ja)" }
    ],
    initialValue: current
  });

  if (isCancel(answer)) {
    cancel("Canceled.");
    process.exitCode = 1;
    return current;
  }
  return answer as LanguageCode;
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
      warnings: session.warnings
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
      warnings: session.warnings
    };
  } catch {
    return {
      status: "invalid",
      source: session.source,
      warnings: session.warnings
    };
  }
}

function createPromptCommand(): Command {
  const prompt = new Command("prompt");
  prompt.description("Prompt commands");

  prompt
    .command("list")
    .argument("<notebookId>", "NotebookLM notebook id")
    .option("--type <artifactType>", "Filter type")
    .option("--json", "Output strict JSON")
    .option("--limit <n>", "Limit result count")
    .action(async (notebookId: string, options: ListCommandOptions) => {
      const language = await resolveLanguage();
      const adapter = new NotebookLmSdkAdapter();
      const service = new PromptExtractorService(adapter);

      const results = await service.listPrompts(notebookId, {
        type: parseType(language, options.type),
        limit: parseLimit(language, options.limit)
      });

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(t(language, "prompt.empty"));
        return;
      }

      console.log(t(language, "prompt.table.header"));
      for (const result of results) {
        console.log(formatListRow(result));
      }
    });

  prompt
    .command("get")
    .argument("<notebookId>", "NotebookLM notebook id")
    .argument("<artifactId>", "Studio artifact id")
    .option("--json", "Output strict JSON")
    .option("--save", "Save output files")
    .option("--format <format>", "Save format: json|md")
    .option("--out <path>", "Output file or directory path")
    .action(
      async (
        notebookId: string,
        artifactId: string,
        options: GetCommandOptions
      ) => {
        const language = await resolveLanguage();
        const adapter = new NotebookLmSdkAdapter();
        const service = new PromptExtractorService(adapter);
        const result = await service.getPrompt(notebookId, artifactId);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`${t(language, "prompt.field.artifactId")}: ${result.artifactId}`);
          console.log(`${t(language, "prompt.field.type")}: ${result.artifactType}`);
          console.log(
            `${t(language, "prompt.field.method")}: ${result.prompt.method} (${result.prompt.confidence})`
          );
          console.log(`${t(language, "prompt.field.prompt")}: ${result.prompt.text}`);
          if (result.warnings.length > 0) {
            console.log(
              `${t(language, "prompt.field.warnings")}: ${result.warnings.join(" | ")}`
            );
          }
        }

        if (options.save) {
          const written = await savePromptResult(result, {
            format: parseFormat(language, options.format),
            out: options.out
          });
          for (const target of written) {
            console.log(`${t(language, "prompt.saved")}: ${target}`);
          }
        }
      }
    );

  return prompt;
}

function createConfigCommand(): Command {
  const config = new Command("config");
  config.description("Configuration commands");

  config
    .command("get")
    .argument("[key]", "Config key")
    .action(async (key?: string) => {
      const language = await resolveLanguage();
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
    });

  config
    .command("set")
    .argument("<key>", "Config key")
    .argument("[value]", "Config value")
    .action(async (key: string, value?: string) => {
      const current = await loadConfig();
      const language = current.language;

      if (key !== "language") {
        throw new Error(t(language, "config.key.unknown", { key }));
      }

      let nextLanguage: LanguageCode;
      if (!value) {
        nextLanguage = await pickLanguageInteractive(language);
      } else if (value === "en" || value === "ja") {
        nextLanguage = value;
      } else {
        throw new Error(t(language, "config.value.invalidLanguage", { value }));
      }

      const next = await setLanguage(nextLanguage);
      console.log(
        t(next.language, "config.language.changed", {
          value: next.language
        })
      );
    });

  config.command("reset").action(async () => {
    const language = await resolveLanguage();
    await resetConfig();
    await saveConfig(DEFAULT_CONFIG satisfies AppConfig);
    console.log(t(language, "config.reset"));
  });

  return config;
}

function createAuthCommand(): Command {
  const auth = new Command("auth");
  auth.description("Authentication commands");

  auth.command("status").action(async () => {
    const config = await loadConfig();
    const language = config.language;
    const result = await validateStoredSession();

    const nextConfig: AppConfig = {
      ...config,
      auth: {
        lastValidatedAt: new Date().toISOString(),
        lastSource: result.source,
        lastStatus: result.status
      }
    };
    await saveConfig(nextConfig);

    if (result.status === "valid") {
      console.log(
        t(language, "auth.status.valid", {
          source: result.source
        })
      );
    } else if (result.status === "missing") {
      console.log(t(language, "auth.status.missing"));
    } else {
      console.log(t(language, "auth.status.invalid"));
    }

    for (const warning of result.warnings) {
      console.warn(warning);
    }
  });

  auth.command("login").action(async () => {
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
        lastStatus: status.status
      }
    });
    console.log(t(language, "auth.login.done"));
  });

  auth.command("logout").action(async () => {
    const config = await loadConfig();
    const language = config.language;
    await clearStoredSession();
    await saveConfig({
      ...config,
      auth: {
        lastValidatedAt: new Date().toISOString(),
        lastSource: "none",
        lastStatus: "missing"
      }
    });
    console.log(t(language, "auth.logout.done"));
  });

  return auth;
}

function createUpdateCommand(): Command {
  const update = new Command("update");
  update.description("Update commands");

  update.command("check").action(async () => {
    const config = await loadConfig();
    const language = config.language;
    const pkg = await loadPackageMeta();
    const result = await checkForUpdates({
      packageName: pkg.name,
      currentVersion: pkg.version,
      config,
      force: true
    });
    await saveConfig(result.nextConfig);

    if (!result.latestVersion) {
      console.log(t(language, "update.unreachable"));
      return;
    }
    if (result.hasUpdate) {
      console.log(
        t(language, "update.available", {
          current: pkg.version,
          latest: result.latestVersion,
          pkg: pkg.name
        })
      );
      return;
    }
    console.log(
      t(language, "update.latest", {
        current: pkg.version
      })
    );
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
    force: false
  });

  if (!result.checked) return;
  await saveConfig(result.nextConfig);

  if (!result.latestVersion) return;
  if (!result.hasUpdate) return;

  console.error(
    t(language, "update.available", {
      current: pkg.version,
      latest: result.latestVersion,
      pkg: pkg.name
    })
  );
}

export function createProgram(): Command {
  const program = new Command("nlm");
  program
    .description("NotebookLM custom prompt helper CLI")
    .showHelpAfterError("(Run with --help for usage.)");

  program.addCommand(createPromptCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createAuthCommand());
  program.addCommand(createUpdateCommand());
  return program;
}

export async function runCli(argv: string[]): Promise<number> {
  void maybeRunStartupUpdateCheck(argv).catch(() => {
    // Do not block command execution for background update checks.
  });
  const program = createProgram();
  await program.parseAsync(argv, { from: "user" });
  return 0;
}
