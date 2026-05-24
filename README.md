# nlm-custom-prompt-viewer

Recover and reuse custom prompts used by NotebookLM Studio artifacts from the command line.

[![npm version](https://img.shields.io/npm/v/nlm-custom-prompt-viewer?style=flat-square)](https://www.npmjs.com/package/nlm-custom-prompt-viewer)
![Bun](https://img.shields.io/badge/Bun-1.x-black?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue?style=flat-square)

> [!IMPORTANT]
> This project depends on `notebooklm-sdk` (unofficial reverse-engineered API behavior).  
> Breakages can happen when NotebookLM internals change.

## Features

- Extract custom prompts from Studio artifacts:
  - `slides`, `video`, `audio`, `quiz`, `flashcards`
- Fallback recovery using Notebook Q&A when direct metadata extraction is unavailable
- Save outputs as `json` and/or `md`
- Multilingual CLI messages:
  - default `en`
  - switchable to `ja`
- Auth lifecycle commands with secure local storage strategy:
  - keychain-first (`keytar`, when available)
  - strict file fallback (`~/.notebooklm/session.json`, `0600` check)
- Cached update notifications (24h window)

## Installation

```bash
bun install
bun run build
```

Global usage:

```bash
bun add -g nlm-custom-prompt-viewer
```

## Quick Start

1. Authenticate once:

```bash
nlm auth login
```

2. List prompts in a notebook:

```bash
nlm prompt list <notebookId>
```

3. Get one artifact prompt and save both formats:

```bash
nlm prompt get <notebookId> <artifactId> --save
```

## CLI Overview

### Prompt commands

```bash
nlm prompt list <notebookId> [--type <artifactType>] [--json] [--limit <n>]
nlm prompt get <notebookId> <artifactId> [--json] [--save] [--format json|md] [--out <path>]
```

### Config commands

```bash
nlm config get [key]
nlm config set language [en|ja]
nlm config reset
```

### Auth commands

```bash
nlm auth status
nlm auth login
nlm auth logout
```

### Update commands

```bash
nlm update check
```

## Output Behavior

- `prompt list`:
  - table output by default
  - machine-readable with `--json`
- `prompt get --save` default paths:
  - `./outputs/<notebookId>/<artifactId>.json`
  - `./outputs/<notebookId>/<artifactId>.md`
- Extraction mode labels:
  - `direct` + `high`
  - `qa_fallback` + `inferred`

## Language Configuration

Default language is `en`.

```bash
nlm config set language ja
nlm config set language en
```

If you omit the value, interactive selection is shown.

## Development

### With Bun scripts

```bash
bun run typecheck
bun run test
bun run build
bun run ci
```

### With justfile

```bash
just install
just typecheck
just test
just build
just ci
```

## Notes

> [!TIP]
> For automation, prefer `--json` output and pipe results into your own tooling.

> [!NOTE]
> If `keytar` is unavailable in your runtime, the CLI automatically falls back to secure file-based session storage.
