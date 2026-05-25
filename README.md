<div align="center">

# nlm-custom-prompt-viewer

Recover and reuse custom prompts used by NotebookLM Studio artifacts from the command line.

[![npm version](https://img.shields.io/npm/v/nlm-custom-prompt-viewer?style=flat-square)](https://www.npmjs.com/package/nlm-custom-prompt-viewer)
![Bun](https://img.shields.io/badge/Bun-1.x-black?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue?style=flat-square)

<img src="assets/demo.gif" width="1000" alt="Demo">

</div>

> [!IMPORTANT]
> This project depends on `notebooklm-sdk` (unofficial reverse-engineered API behavior).  
> Breakages can happen when NotebookLM internals change.

## Features

- Extract custom prompts from Studio artifacts:
  - `slides`, `video`, `audio`, `quiz`, `flashcards`, `report`, `mind_map`, `infographic`, `data_table`
- Two extraction modes:
  - **Fast (default)**: direct metadata extraction (`method: direct`, `confidence: high`)
  - **Infer (`--infer`)**: Q&A fallback when direct extraction is unavailable (`method: qa_fallback`, `confidence: inferred`)
- Save outputs as `json` and/or `md`
- Download artifact outputs with notebook-scoped save paths
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
nlmv auth login
```

2. List prompts in a notebook:

```bash
nlmv prompt list <notebookId>
```

3. Get one artifact prompt and save both formats:

```bash
nlmv prompt get <notebookId> <artifactId> --save
```

4. Download one artifact or all exportable artifacts:

```bash
nlmv prompt download <notebookId> <artifactId>
nlmv prompt download-all <notebookId>
```

## CLI Overview

### Prompt commands

```bash
nlmv prompt list <notebookId> [--type <artifactType>] [--json] [--limit <n>] [--infer]
nlmv prompt get <notebookId> <artifactId> [--json] [--save] [--format json|md] [--out <path>]
nlmv prompt download <notebookId> <artifactId> [--out <path>] [--slide-format pdf|pptx]
nlmv prompt download-all <notebookId> [--out <path>] [--slide-format pdf|pptx]
```

### Config commands

```bash
nlmv config get [key]
nlmv config set language [en|ja]
nlmv config reset
```

### Auth commands

```bash
nlmv auth status
nlmv auth login
nlmv auth logout
```

### Update commands

```bash
nlmv update check
```

## Extraction Modes

| Mode           | Flag      | method        | confidence  | Speed |
|----------------|-----------|---------------|-------------|-------|
| Fast (default) | —         | `direct`      | `high`      | Fast  |
| Infer          | `--infer` | `qa_fallback` | `inferred`  | Slow  |

`prompt list` defaults to fast mode. Pass `--infer` to fall back to Notebook Q&A
for artifacts where direct extraction yields no result.

`prompt get` always attempts direct extraction first, then falls back to Q&A
automatically — `--infer` is not required for single-artifact retrieval.

## Output Behavior

- `prompt list`:
  - table output by default
  - machine-readable with `--json`
- `prompt get --save` default paths:
  - `./outputs/<slug>.json`
  - `./outputs/<slug>.md`
  - `<slug>` = `slugify(artifactTitle)` (lowercase + hyphens); falls back to `artifactId`
  - Example: "My AI Podcast" → `./outputs/my-ai-podcast.json`
- `prompt download` / `prompt download-all` default paths:
  - `./outputs/downloads/<notebookId>/<slug>.<ext>`
  - `<slug>` = `slugify(artifactTitle)` (lowercase + hyphens); falls back to `artifactId`
  - `slides` default to `.pdf`; use `--slide-format pptx` for `.pptx`
  - Extensions:
    - `video` → `.mp4`
    - `audio` → `.mp3`
    - `slides` → `.pdf` or `.pptx`
    - `infographic` → `.png`
    - `report` → `.md`
    - `quiz` / `flashcards` → `.html`
    - `data_table` → `.csv`
    - `mind_map` → `.json`
- `--out <path>` behavior:
  - **Directory** (no `.json`/`.md` extension): saves `<path>/<slug>.<format>` for each format
  - **File** (`.json` or `.md` extension) + `--format <fmt>`: saves directly to `<path>`
  - Tilde expansion is supported (`~/docs` → `$HOME/docs`)
- download `--out <path>` behavior:
  - `prompt download`: file extension included = write directly to that file, otherwise treat as directory
  - `prompt download-all`: always treats `--out` as a directory
- `--format json|md` limits output to one format (default: both)
- download progress:
  - binary artifact downloads use `cli-progress`
  - when `Content-Length` is available, progress is byte-accurate
  - when it is missing, the CLI falls back to bytes-received display without fake percentages
- Config file: `~/.config/nlm-prompt/config.json`
  (override: `$XDG_CONFIG_HOME/nlm-prompt/config.json`)
- Session file: `~/.notebooklm/session.json`

## Interactive Mode

Run without arguments to enter the interactive menu:

```bash
nlmv
```

Arrow-key navigation covers all commands. Required arguments can also be omitted
to trigger inline prompts:

```bash
nlmv prompt list    # prompts for notebook ID interactively
nlmv prompt get     # prompts for notebook + artifact selection, then offers save/download
nlmv prompt download     # prompts for notebook + artifact selection
nlmv prompt download-all # prompts for notebook selection
nlmv config set     # prompts for key and value
```

## Language Configuration

Default language is `en`.

```bash
nlmv config set language ja
nlmv config set language en
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
just prompt-download <notebookId> <artifactId>
just prompt-download-all <notebookId>
just cli "prompt download <notebookId> <artifactId> --slide-format pptx"
```

## Notes

> [!TIP]
> For automation, prefer `--json` output and pipe results into your own tooling.

> [!NOTE]
> If `keytar` is unavailable in your runtime, the CLI automatically falls back to secure file-based session storage.

> [!NOTE]
> For tests or debugging, you can force file-only session handling with `NLM_PROMPT_DISABLE_KEYTAR=1`. This does not change the meaning of `NLM_PROMPT_SESSION_FILE`; it only bypasses keychain lookup.

> [!NOTE]
> `nlm-prompt` is an alias for `nlmv` — both point to the same binary.
