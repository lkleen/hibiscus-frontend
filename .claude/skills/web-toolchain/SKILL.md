---
name: web-toolchain
description: Toolchain conventions for pnpm + Turborepo web monorepos — script naming (start:local / start:remote, never an unprefixed alias), pnpm workspace and packageManager pinning, turbo.json task graph, root scripts, .nvmrc, the strict tsconfig baseline, ESLint flat config with max-params 3, Prettier settings, Vitest setup, .githooks pre-push, .gitignore additions and local env files. Use when touching package.json scripts, build/lint/test/format config, git hooks, local dev setup or environment files in a web project.
---

# Web Toolchain

Default toolchain conventions for web-based monorepo projects. Covers pnpm, Turborepo, TypeScript,
ESLint, Prettier, Vitest, and Git hooks.

## Script Naming — Local vs Remote Variants

When a script has both a local and a remote variant, **always** name both explicitly:

```json
"dev:local": "...",
"dev:remote": "..."
```

Never add an unprefixed alias that silently maps to one of them (`"dev": "..."` when `dev:local` and `dev:remote` both exist). The unprefixed form implies it works in any context but doesn't — it silently picks one variant, which is confusing and error-prone.

This applies to any command pair: `dev`, `start`, `db:reset`, etc.

## Start Commands — Local vs Remote

Use `start:local` and `start:remote` as the canonical entry points for running the project:

- **`start:local`** — starts all local services (dev containers, local database, local auth) and the
  frontend dev server. On exit it must prompt the developer to shut down those services. Implement
  as a shell script so the cleanup trap can run interactively.
- **`start:remote`** — starts only the local frontend dev server, configured to connect to the
  remote backend, database, and auth service. No Docker or local services needed.

Never add a plain `start` that silently maps to one of these variants.

## Package Manager — pnpm

- Use pnpm workspaces. Root `pnpm-workspace.yaml` declares `packages: ['apps/*']` (extend as needed).
- Pin `packageManager` in root `package.json`:
  ```json
  "packageManager": "pnpm@10.15.1"
  ```
- Use `pnpm.onlyBuiltDependencies` to whitelist packages that need native builds:
  ```json
  "pnpm": {
    "onlyBuiltDependencies": ["@parcel/watcher", "esbuild", "lmdb", "msgpackr-extract"]
  }
  ```

## Task Runner — Turborepo

Root `turbo.json` — standard task graph for a web monorepo:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "typecheck": {},
    "format:fix": {},
    "format:check": {},
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- Add project-specific `env` keys under `build` when the build reads environment variables.
- Cache outputs live in `.turbo/` — add to `.gitignore`.
- Only changed packages re-run on each `turbo` invocation.

## Root Scripts

Root `package.json` scripts delegate to `turbo run`:

```json
"scripts": {
  "prepare": "[ -d .git ] && git config core.hooksPath .githooks || true",
  "build": "turbo run build",
  "test": "turbo run test",
  "lint": "turbo run lint",
  "typecheck": "turbo run typecheck",
  "format:fix": "turbo run format:fix",
  "format:check": "turbo run format:check",
  "start:local": "bash scripts/start-local.sh",
  "start:remote": "turbo run start:remote"
}
```

The `prepare` script activates Git hooks automatically after `pnpm install` — no manual setup needed.

## Local Development Setup

This pattern is standard across all web projects — document it in `claude-config`, not in the
project's own `.claude/` folder.

**Prerequisites** (document in project README or `infrastructure.md`):
- Node.js — version pinned in `.nvmrc`
- pnpm
- Docker — required for `start:local` (local services run in containers)
- Any service-specific CLI (e.g. Supabase CLI, Firebase CLI)

**First-time setup:**

```bash
pnpm install      # install all workspace deps (also wires up Git hooks via prepare)
```

**Running the app:**

```bash
pnpm start:local    # start all local services + frontend dev server
                    # prompts to shut down services on exit (Ctrl+C)
pnpm start:remote   # frontend dev server only, connected to remote backend/DB/auth
                    # no Docker or local services needed
```

**Env files** — both gitignored, never committed:

| File | Used by | How to populate |
|------|---------|-----------------|
| `.env.dev.local` | `start:local` | written automatically by `start:local` script from service CLI |
| `.env.dev.remote` | `start:remote` | copy from `.env.example`, fill in remote credentials |

Always provide an `.env.example` at the repo root as a reference template.

## Node.js Version

- Pin the version in `.nvmrc` at the repo root (e.g. `22`).
- Vercel and CI read `.nvmrc` automatically.

## TypeScript

`tsconfig.json` baseline for strict, modern TypeScript:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "declaration": false,
    "moduleResolution": "bundler",
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022", "dom"]
  }
}
```

- `sourceMap: true` is required for production debugging.
- `moduleResolution: "bundler"` is the correct setting for Vite/esbuild/Angular CLI toolchains.
- Never disable `strict` or any of the `noImplicit*` flags.

## ESLint

Use the flat config format (`eslint.config.js`). Baseline for TypeScript projects:

```js
// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
    ],
    rules: {
      '@typescript-eslint/max-params': ['error', { max: 3 }],
    },
  },
);
```

- Always enable `@typescript-eslint/max-params` at `max: 3`. When a function needs more than 3
  parameters, introduce a dedicated params/config type.
- Use `typescript-eslint` recommended + stylistic presets as the baseline — do not disable rules
  without a documented reason.
- Framework-specific rules (Angular, React, etc.) extend this baseline in the app's own config file.

## Prettier

`.prettierrc` at the repo root:

```json
{
  "printWidth": 100,
  "trailingComma": "all",
  "singleQuote": true,
  "semi": true,
  "tabWidth": 2
}
```

- `printWidth: 100` — wider than the default 80 to accommodate TypeScript generics and decorators.
- `trailingComma: "all"` — trailing commas in function parameters (requires ES2017+).
- Always run `pnpm format:fix` before committing, `pnpm format:check` in CI and pre-push.

## Vitest

Per-app `tsconfig.spec.json` extends the app tsconfig and adds Vitest globals:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./out-tsc/spec",
    "types": ["vitest/globals", "node"]
  },
  "include": ["src/**/*.spec.ts", "src/**/*.d.ts"]
}
```

- Use `happy-dom` as the DOM implementation for unit tests (lighter than jsdom).
- Test files: `*.spec.ts` co-located next to the source file.
- Angular projects use `@angular/build:unit-test` with `runner: "vitest"` in `angular.json` instead
  of a standalone `vite.config.ts`.

## Git Hooks

Store hooks in `.githooks/` at the repo root. The `prepare` script in `package.json` wires them up
via `git config core.hooksPath .githooks` on every `pnpm install`.

`.githooks/pre-push`:

```sh
#!/bin/sh
set -e

echo "pre-push: typecheck..."
pnpm typecheck

echo "pre-push: lint..."
pnpm lint

echo "pre-push: format check..."
pnpm format:check

echo "pre-push: tests..."
pnpm test

echo "pre-push: all checks passed."
```

- `set -e` — any failing check aborts the push immediately.
- All four checks must pass before a push is accepted: typecheck → lint → format:check → test.
- Do not bypass hooks with `--no-verify` — fix the underlying issue.

## .gitignore Additions

Beyond the standard Angular/Node entries, always include:

```gitignore
# Turborepo
.turbo/

# Environment secrets
.env.dev
.env.dev.remote
.env.dev.local
```