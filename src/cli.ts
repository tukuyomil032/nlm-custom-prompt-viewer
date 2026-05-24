import { Command } from "commander";
import { NotebookLmSdkAdapter } from "./adapters/notebooklm.js";
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

function parseType(input?: string): SupportedArtifactType | undefined {
  if (!input) return undefined;
  if ((SUPPORTED_ARTIFACT_TYPES as readonly string[]).includes(input)) {
    return input as SupportedArtifactType;
  }
  throw new Error(
    `Unsupported --type '${input}'. Supported: ${SUPPORTED_ARTIFACT_TYPES.join(", ")}`
  );
}

function parseFormat(input?: string): SaveFormat | undefined {
  if (!input) return undefined;
  if (input === "json" || input === "md") return input;
  throw new Error("`--format` must be `json` or `md`.");
}

function parseLimit(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("`--limit` must be an integer >= 1.");
  }
  return Math.floor(parsed);
}

function createPromptCommand(): Command {
  const prompt = new Command("prompt");
  prompt.description("Read and export custom prompts from NotebookLM Studio artifacts.");

  prompt
    .command("list")
    .argument("<notebookId>", "NotebookLM notebook id")
    .option("--type <artifactType>", "Filter type")
    .option("--json", "Output strict JSON")
    .option("--limit <n>", "Limit result count")
    .action(async (notebookId: string, options: ListCommandOptions) => {
      const adapter = new NotebookLmSdkAdapter();
      const service = new PromptExtractorService(adapter);

      const results = await service.listPrompts(notebookId, {
        type: parseType(options.type),
        limit: parseLimit(options.limit)
      });

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log("No supported artifacts found, or prompt extraction failed.");
        return;
      }

      console.log("artifactId\ttype\tmethod\tprompt");
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
        const adapter = new NotebookLmSdkAdapter();
        const service = new PromptExtractorService(adapter);
        const result = await service.getPrompt(notebookId, artifactId);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`artifactId: ${result.artifactId}`);
          console.log(`type: ${result.artifactType}`);
          console.log(`method: ${result.prompt.method} (${result.prompt.confidence})`);
          console.log(`prompt: ${result.prompt.text}`);
          if (result.warnings.length > 0) {
            console.log(`warnings: ${result.warnings.join(" | ")}`);
          }
        }

        if (options.save) {
          const written = await savePromptResult(result, {
            format: parseFormat(options.format),
            out: options.out
          });
          for (const target of written) {
            console.log(`saved: ${target}`);
          }
        }
      }
    );

  return prompt;
}

export function createProgram(): Command {
  const program = new Command("nlm");
  program
    .description("NotebookLM custom prompt helper CLI")
    .showHelpAfterError("(Run with --help for usage.)");

  program.addCommand(createPromptCommand());
  return program;
}

export async function runCli(argv: string[]): Promise<number> {
  const program = createProgram();
  await program.parseAsync(argv, { from: "user" });
  return 0;
}
