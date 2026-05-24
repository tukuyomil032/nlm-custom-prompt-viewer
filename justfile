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

lint:
  bun run lint

ci:
  bun run ci
