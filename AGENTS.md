# AGENTS Guide
This file is for coding agents working in this repo.
Use it as the default operating guide for implementation and validation.

## Repository Scope
- Monorepo root currently has one app: `apps/server`.
- Stack: Bun runtime, TypeScript, Hono.
- CI workflow: `.github/workflows/server-ci.yml`.

## Server Structure (Current)
- App entrypoints live in `apps/server/src/app.ts` and `apps/server/src/index.ts`.
- Runtime orchestration lives in `apps/server/src/runtime/*`.
- Event contracts and stream transport live in `apps/server/src/events/*`.
- Business/data access logic lives in `apps/server/src/services/**`.
- Keep tests out of `src`; place them under `apps/server/tests/**`.

## Service Naming Rules
- Use `*Service` naming for interfaces, variables, and dependency injection options.
- Use factory names `createDrizzle...Service` and `createInMemory...Service`.
- Avoid introducing new `*Store` names/files; prefer `*Service` consistently.
- When touching legacy areas that still use `store` naming, migrate to `service` in the same change when safe.

## Extra Rule Files
At the time this file was written, none were found:
- `.cursorrules` (not present)
- `.cursor/rules/` (not present)
- `.github/copilot-instructions.md` (not present)
If any are added later, treat them as higher-priority instructions.

## Working Directory
Run most commands in `apps/server`.
From repo root, use `cd apps/server && <command>`.

## Install
From `apps/server`:
```bash
bun install
```
For reproducible CI/local checks:
```bash
bun install --frozen-lockfile
```

## Build, Lint, Test, Typecheck
From `apps/server`:
- Dev server (watch/reload): `bun run dev`
- Tests (all): `bun run test`
- Tests (watch mode): `bun run test:watch`
- Lint: `bun run lint`
- Lint (auto-fix): `bun run lint:fix`
- Type-check: `bun run check-types`
- Format check: `bun run format`
- Format write: `bun run format:write`

## Single Test Execution (Important)
Use Bun test filters directly when making targeted changes:
- Single file: `bun test tests/api/app.test.ts`
- Name filter: `bun test -t "returns success response"`
- File + name filter: `bun test tests/api/app.test.ts -t "GET /api"`
Workflow recommendation:
1. Run the most targeted single test first.
2. Then run `bun run test` before finishing.

## CI Contract
Workflow path: `.github/workflows/server-ci.yml`.
Triggers:
- Push to `master` (for `apps/server/**` changes)
- Pull request to `master` (for `apps/server/**` changes)
CI steps (in order):
1. `bun install --frozen-lockfile`
2. `bun run format`
3. `bun run lint`
4. `bun run check-types`
5. `bun test`
Keep local validation aligned with this order.

## Formatting Rules
Config: `apps/server/prettier.config.mjs`.
Defaults currently used:
- Semicolons enabled
- Double quotes
- Trailing commas (`all`)
- `printWidth: 100`
- `tabWidth: 2`
- `useTabs: false`
Guideline: prefer Prettier output over manual formatting choices.

## Linting Rules
Config: `apps/server/eslint.config.mjs` (flat config).
Baseline includes:
- `@eslint/js` recommended
- `typescript-eslint` recommended
- `eslint-plugin-unicorn` recommended
- `eslint-config-prettier`
- `globals` configured for Bun + Node
Intentional Unicorn exceptions currently disabled:
- `unicorn/filename-case`
- `unicorn/prevent-abbreviations`
Do not add blanket disables unless absolutely necessary.

## TypeScript Guidance
Config: `apps/server/tsconfig.json`.
Important settings:
- `strict: true`
- `noEmit: true`
- `moduleResolution: bundler`
- `verbatimModuleSyntax: true`
- Bun globals via `"types": ["bun"]`
Agent expectations:
- Avoid `any`; prefer `unknown` + narrowing.
- Use explicit types at module boundaries.
- Do not add explicit return types on function implementations; rely on TypeScript inference unless a type predicate or overload requires an explicit annotation.
- Validate external/untrusted inputs.
- Keep return shapes predictable and stable.

## Imports and Modules
- Use ESM `import`/`export` only.
- Use relative imports for local modules.
- Keep imports minimal; remove unused imports quickly.
- Prefer shallow, decoupled module boundaries.

## Naming Conventions
- Files: short, descriptive, lower-case where practical.
- Variables/functions: `camelCase`.
- Types/interfaces/classes: `PascalCase`.
- True constants: `UPPER_SNAKE_CASE`.
- Test names: behavior-focused (`returns ...`, `throws ...`).

## API and Error Handling
Current API app entry: `apps/server/src/app.ts`.
- Keep handlers thin; move logic to reusable functions/modules.
- Return structured JSON payloads.
- Use explicit HTTP status codes for non-happy paths.
- Do not expose internal stack traces or sensitive details.
- For unexpected failures, return generic messages and log server-side.

## Testing Conventions
- Place tests under `tests/` (`tests/api`, `tests/services`, `tests/integration`).
- Use `describe` blocks per route/module.
- Assert both status and payload.
- Add regression tests for bug fixes.
- Keep tests deterministic and isolated.

## Change Management
- Keep changes focused and reviewable.
- Avoid unrelated refactors in the same patch.
- Update docs/scripts when behavior or commands change.
- If tooling config changes, run full validation before finishing.

## Pre-PR Checklist
From `apps/server`:
1. `bun run format:write`
2. `bun run lint`
3. `bun run check-types`
4. `bun run test`
If any step fails, fix root cause rather than bypassing checks.
