# ADR-0002: Freeze `lib/` as the legacy Firepad 1.x bundle

## Status

Accepted (2026-09-27). Resolves finding A1 of `docs/REMEDIATION-PLAN.md`.

## Context

The repository carries two implementations of the same synchronization seam:

- `lib/sync-seam.js` (with `lib/sync-seam.d.ts`), plain JS concatenated into the legacy
  `dist/firepad.js` bundle and exposed as `firepad.SyncSeam` on `window.firepad`;
- `src/adapters`, the TypeScript `SyncSeam` shipped as `@pyric/pad/adapters`.

Every fix to the seam had to be made twice, and the two had already drifted. The plan offered two
options: (a) freeze `lib/` and have the legacy bundle consume the TypeScript seam, or (b) port the
remaining `lib/` OT and rich-text code into `src/`, a multi-week effort.

## Decision

Option (a). `lib/` is frozen as the legacy Firepad 1.x bundle: it gets no new features and is not
ported to `src/`.

There is one seam implementation, `src/adapters`. `lib/sync-seam.js` and `lib/sync-seam.d.ts` are
deleted, and the build bundles `src/adapters/index.ts` with esbuild into an IIFE that is placed
before the `lib/` files in `dist/firepad.js`, so the legacy bundle consumes the TypeScript seam (see
`tools/bundle.js`). This work is task T11 of the remediation plan.

## Consequences

- Seam fixes land once, in `src/adapters`, and reach both `@pyric/pad/adapters` and the legacy
  bundle.
- The lint guardrails on `lib/**/*.js` are relaxed to fit ES5 code that will not be rewritten
  (`eslint.config.mjs`): `no-var` and `max-lines` are off, and `max-depth`,
  `max-lines-per-function`, and `max-params` are warnings. The rest of the repo keeps them as
  errors.
- `lib/` files with no remaining references can be deleted, but not refactored.
- New features (editors, adapters, React hooks) go in `src/` only. Rich text and the Ace / Monaco
  adapters stay available only through the legacy bundle.
