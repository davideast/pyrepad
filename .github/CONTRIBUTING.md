# Contributing to Pyrepad (`@pyric/pad`)

Bugs and feature requests go in [GitHub issues](https://github.com/davideast/pyrepad/issues).
For a new feature, open an issue with a proposal before sending a pull request.

## Local setup

Requirements: [Bun](https://bun.sh) and Node.js >= 22.15 (the Pyric dev server runs under Node; see
[Local development with Pyric](../README.md#local-development-with-pyric) in the README).

The Pyric packages (`pyric`, `pyric-admin`, `create-pyric`, `@pyric/cli`) are pinned to the npm
release `0.1.0-alpha.24` (the `next` dist-tag), which is the first published build with the Node
host used by `vite.config.mjs` (`hosted: true`). To test an unreleased Pyric checkout instead, pack
it with `<pyric>/.agents/skills/pyric-node-host/scripts/pack-local.sh` and point the four
devDependencies at the tarballs locally; do not commit that change. Then:

```bash
bun install
```

`bun install` also installs the Husky git hooks (the `prepare` script).

## The gate

Every change must pass the same checks CI runs:

```bash
bun run typecheck && bun run lint && PYRIC_SANDBOX=1 bun test test/specs/*.spec.js
bun run test:e2e:playwright
```

- `bun run typecheck` runs `tsc --noEmit` over `src/**` and `lib/**/*.d.ts`.
- `bun run lint` runs `eslint .`, which covers the whole repo (`src/`, `test/`, `tools/`, `lib/`);
  only `examples/`, `dist/`, and config files are ignored. The architecture guardrails (300-line
  files, 60-line functions, 4 parameters, nesting depth 4) are errors everywhere except in spec
  files, which have no length limits, and in `lib/`, the frozen legacy bundle, where they are
  relaxed (see [ADR-0002](../docs/adr/0002-freeze-lib-legacy-bundle.md)).
- The unit specs require `PYRIC_SANDBOX=1`; `test/setup-globals.js` (preloaded by `bunfig.toml`)
  refuses to run without it. `bun run test` sets it for you.
- `bun run test:e2e:playwright` builds the bundle and starts its own Vite server on port 5188. Set
  `PW_PORT` to use another port (for example when several checkouts run at once). Install the
  browser once with `bun x playwright install chromium`.

## Pre-commit hook

`.husky/pre-commit` runs `lint-staged` (ESLint `--fix` and Prettier on staged `src/**/*.{ts,tsx,js}`)
and then the unit specs with `PYRIC_SANDBOX=1`. A commit that breaks either is rejected.

## Structure

- `src/core`, `src/adapters`, `src/editors`, `src/react` are the four `@pyric/pad/*` subpath
  modules. New code goes here.
- `lib/` is the legacy Firepad 1.x bundle. It is frozen: fixes only, no new features.
- `test/specs/` holds the Bun unit specs; `test/e2e-playwright/` the browser specs.
- `examples/` holds runnable demos; `examples/legacy/` the old Firepad 1.5 CDN examples.
- Domain vocabulary is in [`CONTEXT.md`](../CONTEXT.md); architecture decisions are in
  [`docs/adr/`](../docs/adr).

Keep changes small and scoped. The operating rules in
[`docs/REMEDIATION-PLAN.md`](../docs/REMEDIATION-PLAN.md) describe how work is split: one
change per branch, bug fixes start with a failing spec, and no new abstractions or unrelated edits
in the same change.
