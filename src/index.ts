#!/usr/bin/env node
import { runCli } from "./cli.js";

runCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[nlm-prompt] ${message}`);
    process.exitCode = 1;
  });
