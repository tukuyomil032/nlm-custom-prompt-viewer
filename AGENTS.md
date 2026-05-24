# Project Agent Rules (Concise)

## Language

- Reply in concise, polite Japanese.

## Preferred CLI Tools

- `rg` instead of `grep`
- `fd` instead of `find`
- `bat` instead of `cat`
- `eza` instead of `ls`
- `dust` instead of `du`

## Commit Policy

- One task per commit.
- Use English prefixes: `feat:`, `fix:`, `ref:`, `docs:`, `chore:`.
- Use multi-line commit messages (`-m` x3).

## Safety

- Do not run destructive git commands unless explicitly requested.
- Do not revert unrelated user changes.
- If unexpected file modifications appear, pause and ask first.

## Workflow Checklist

1. Run build/test/typecheck for touched areas.
2. Keep diffs focused and avoid unrelated formatting churn.
3. Update docs only when requested for this task.
