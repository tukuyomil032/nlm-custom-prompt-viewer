import { cancel, isCancel, select } from "@clack/prompts";
import { Command } from "commander";
import { NotebookLmSdkAdapter } from "./adapters/notebooklm.js";
import {
  loadConfig,
  resetConfig,
  saveConfig,
  setLanguage
} from "./config/store.js";
import type { AppConfig, LanguageCode } from "./config/types.js";
import { t } from "./i18n/messages.js";
import { formatListRow, PromptExtractorService } from "./services/promptExtractor.js";
import { savePromptResult, type SaveFormat } from "./services/saveOutput.js";
import {
  SUPPORTED_ARTIFACT_TYPES,
  type SupportedArtifactType
} from "./types.js";

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
    await saveConfig({
      language: "en",
      updateCheck: {
        enabled: true,
        lastCheckedAt: null,
        latestSeenVersion: null
      }
    } satisfies AppConfig);
    console.log(t(language, "config.reset"));
  });

  return config;
}

export function createProgram(): Command {
  const program = new Command("nlm");
  program
    .description("NotebookLM custom prompt helper CLI")
    .showHelpAfterError("(Run with --help for usage.)");

  program.addCommand(createPromptCommand());
  program.addCommand(createConfigCommand());
  return program;
}

export async function runCli(argv: string[]): Promise<number> {
  const program = createProgram();
  await program.parseAsync(argv, { from: "user" });
  return 0;
}
