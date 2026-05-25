set shell := ["zsh", "-lc"]

install:
  bun install

build:
  bun run build

test:
  bun run test

typecheck:
  bun run typecheck

dev:
  bun run dev

dev-cli:
  bun src/index.ts

cli ARGS='':
  bun src/index.ts {{ARGS}}

prompt-download NOTEBOOK_ID ARTIFACT_ID:
  bun src/index.ts prompt download {{NOTEBOOK_ID}} {{ARTIFACT_ID}}

prompt-download-all NOTEBOOK_ID:
  bun src/index.ts prompt download-all {{NOTEBOOK_ID}}

lint:
  bun run lint

ci:
  bun run ci
