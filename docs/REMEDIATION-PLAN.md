# Pyrepad Remediation Plan

Source: whole-repo review of `main` @ 80d42ac (2026-09-27). This document is the contract between
the **orchestrator** (advisor, gatekeeper, merger) and the **sub-agents** (Opus 5.5 only, one task
each, isolated git worktree each). Nothing in here is optional unless marked *decision*.

## Operating rules (apply to every task)

1. **One task, one worktree, one branch** (`fix/<task-id>-<slug>`), created from the orchestrator's
   integration branch `remediation/main`. Agents never touch `main`.
2. **Ownership is by path.** Each task lists the paths it owns. An agent that needs a change outside
   its paths stops and reports the need instead of making it. This is what makes the waves safe to
   run in parallel.
3. **Bug fixes are test-first.** Write the failing spec that reproduces the finding, watch it fail,
   then fix. A fix without a red-then-green spec is rejected.
4. **Gate before reporting:** `bun run typecheck && bun run lint && PYRIC_SANDBOX=1 bun test test/specs/*.spec.js`
   must be green in the worktree. Wave ≥2 tasks also run `bun run test:e2e:playwright`
   (needs a free port; the config uses 5188).
5. **Report format:** finding id(s) addressed → files changed (file:line) → the red/green spec names
   → gate output tail → anything deferred and why. No prose beyond that.
6. **No new abstractions for needs the plan doesn't name.** No renames outside the ones listed. No
   "while I was here" edits.
7. The orchestrator reviews every diff against the finding it claims to fix before merging, merges
   waves in the order below, re-runs the gate on `remediation/main` after each merge, and only then
   starts the next wave.

## Finding index

Critical: C1 typecheck no-op · C2 history ack bug · C3 React never syncs · C4 CM6 not real ·
C5 offline adapter (double commit / reentrant reconcile / silent rollback) · C6 modular Firebase proxy.
Paper cuts: P1 min.js not minified · P2 exports point at .ts, `types/**` missing, hard deps ·
P3 `PYRIC_SANDBOX` no-op · P4 "102 suites" claim, 5/20 specs cover src · P5 lint-staged excludes .tsx,
prettier drift · P6 `ReactiveStream.return()` hangs · P7 no `onDisconnect` · P8 `"agentive"` event
never emitted · P9 exhaustive-deps warning · P10 VERSION ×4 · P11 `tentativeDiff` vs `ghostDiff`.
Standards: S1 guardrails skip lib/test · S2 `strict:false` + `any` · S3 CONTEXT "Avoid" vocabulary in
code · S4 Closure-style privates · S5 marketing comments.
Architecture: A1 parallel JS/TS seam (`lib/sync-seam.js` vs `src/adapters`) · A2 hooks bypass
`SyncSeam` via `as any` · A3 duplicated presence widgets / emitters / file lists · A4 middle men ·
A5 agentive data clump · A6 retry without backoff.
Bloat: B1 grunt/bower/release scripts · B2 karma/test vendor · B3 dead `lib/` files · B4 legacy
examples · B5 font/screenshot · B6 unused deps · B7 stale docs.

## Wave 0 — Foundation (ONE agent, sequential; nothing else starts until merged)

Everything later depends on a real typecheck gate and on stable names. Mechanical work only.

**T0 `foundation`** — owns: `tsconfig.json`, `package.json`, `bun.lock`, `eslint.config.mjs`,
`.prettierrc` (new), `.husky/`, `src/**` *for renames and type errors only*.
- C1: `include: ["lib/**/*.d.ts","src/**/*.ts","src/**/*.tsx"]`; fix the 4 errors
  (`history-stream.ts:95,161`, `codemirror6-driver.ts:230`, `use-pyrepad-editor.ts:38`).
  Do **not** enable `strict` yet (T13 does that).
- P5: lint-staged glob → `src/**/*.{ts,tsx,js}`; add `.prettierrc`; run `prettier --write src`.
- S3 mechanical renames (update all imports/specs): `EditorDriverSeam`→`EditorSeam`,
  `codemirror6-driver.ts`→`codemirror6-adapter.ts`, `RemoteCursorData`→`PresenceState`,
  `MockElement/MockStyle/createMockElement`→`FallbackElement/FallbackStyle/createFallbackElement`.
- P10: single `VERSION` source in `src/version.ts` re-exported by the three index files.
- package.json prep (B6, P2 partial): `react`, `react-dom`, `firebase` → `peerDependencies`
  (+ devDependencies for tests); remove `@babel/core`, `@babel/preset-env`, `jasmine-core`,
  `monaco-editor`; add `@codemirror/state`, `@codemirror/view`, `@testing-library/react` as
  devDependencies (Wave 2 needs them). Leave `exports`/`main` alone (T12 owns).
- Gate must be green. Note: the local-pyric `file:` deps and `overrides` stay as they are.

## Wave 1 — Independent seams (5 agents in parallel; disjoint paths)

**T1 `history-ack`** (C2) — owns `src/adapters/streams/history-stream.ts`, new
`test/specs/history-stream.spec.js`. Red spec: `sendOperation` against a ref with `transaction`,
then `child_added` for that revision → expect one `ack`, zero `operation` echoes. Fix the
revision compare (record `sent.id` for the revision being drained, or compare before increment).
Add a second spec for a *remote* op at the same revision to prove the fix doesn't over-ack.

**T2 `offline-durable`** (C5, A6, P3-adjacent) — owns `src/adapters/offline/**`,
`src/adapters/base-adapter.ts`, `src/core/operations/text-operation.ts` (`fromJSON` only),
`test/specs/offline-durability.spec.js`.
- `commitOperation` must settle: reject on dispose, reject after N retries with exponential
  backoff (A6); `once()` listeners cleaned on dispose.
- Single-flight `reconcile()` (a promise latch); enqueue **or** direct-commit, never both.
- Conflict path emits an `error`/`conflict` event with the dropped op instead of silent
  `console.warn`; spec asserts the event, not a log line.
- `TextOperation.fromJSON` throws on non-array input; spec.

**T3 `firebase-proxy`** (C6) — owns `src/adapters/firebase-adapter.ts`,
`test/specs/adapter-conformance.spec.js`. `child_added/changed/removed` on modular targets use the
matching modular listeners (config gains `onChildAdded` etc.); `off()` calls the returned
unsubscribe; `once("value")` maps to `get`. Specs assert delivered snapshots, not call counts.
Remove the `FirestoreAdapter` alias (it is RTDB semantics; S3/A-speculative).

**T4 `streams`** (P6, P7, P8, A5) — owns `src/adapters/reactive-stream.ts`,
`src/adapters/streams/presence-stream.ts`, `src/adapters/streams/agentive-stream.ts`,
`src/adapters/types.ts` (additive only), new specs. `return()` resolves pending `next()`;
presence writes `onDisconnect().remove()` and awaits/handles `set`/`remove` rejections;
agentive stream emits the `"agentive"` event alongside the stream push; introduce
`AgentivePresenceEvent` as the single parameter type for the agentive path (A5) — additive,
old 4-arg signature kept as a deprecated overload so Wave 2 can migrate callers.

**T5 `bloat-and-tests-infra`** (B1, B2, B4, B5, B6-leftovers, P3, A3 file-list) — owns
`Gruntfile.js`, `bower.json`, `tools/**`, `test/karma.conf.js`, `test/index.html`,
`test/firepad-debug.js`, `test/vendor/**`, `test/setup-globals.js`, `bunfig.toml`, `examples/**`,
`font/**`, `screenshot.png`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE.md`.
- Delete B1/B2. Extract the 34-file list into `tools/lib-files.js` used by both `bundle.js` and
  `setup-globals.js`. Fix P3 so `PYRIC_SANDBOX=1` is the only switch (default real-Firebase
  path removed from tests).
- Move `ace/code/hammer/richtext*/userlist.html`, `firepad-userlist.*`, `firepad.rb` to
  `examples/legacy/` with a README saying they target Firepad 1.5 CDNs; keep `react-*`,
  `pyric-studio-live`, `agentive-pyric-demo`, `offline-indexeddb-demo` and update
  `examples/README.md`.
- *Decision (orchestrator asks the owner before deleting):* `font/` (only the rich-text toolbar
  uses it) and `screenshot.png`. Default if no answer: keep `font/`, delete `screenshot.png`.
- `CHANGELOG.md`: seed with an "Unreleased" section listing this plan's finding ids.

**T6 `core-specs`** (P4) — owns new files only: `test/specs/core-text-operation.spec.js`,
`core-composition.spec.js`, `core-transformation.spec.js`, `core-undo.spec.js`. Direct ESM specs
of `src/core/**` (apply/compose/transform laws, invert, `shouldBeComposedWith`, undo/redo).
Property-style loops over random ops are welcome. Do not modify `src/`.

Merge order after all six report: T5 → T6 → T4 → T1 → T3 → T2 (least to most invasive).

## Wave 2 — Editors and React (3 agents in parallel; then 1)

**T7 `cm6-real`** (C4, A3 widgets) — owns `src/editors/**` except `codemirror-adapter.ts`, and
`test/specs/codemirror6-*.spec.js`, `presence-decorations.spec.js`. Use `@codemirror/state`
`Annotation.of` for remote origin, register the presence plugin via `ViewPlugin.fromClass` +
`decorations` facet, install `EditorView.updateListener`. Extract `PresenceWidgetBase` shared by
the CM5 and CM6 widgets (A3). Specs run against a real `EditorView` in JSDOM, not mocks.

**T8 `react-wiring`** (C3, A2, P9) — owns `src/react/**`, `test/specs/react-hooks.spec.js`.
`usePyrepadEditor` subscribes to `adapter.operations` → `editor.applyOperation`, editor changes →
`adapter.commitOperation`, presence → `setOtherCursor`; honours `defaultText`; drops `dbRef` or
implements it (decide, document). `useCollaborators`/`useAgentiveDiffs` consume the `SyncSeam`
streams (`presence`, `agentive`) — no `as any .on`. Hooks tested with `@testing-library/react`
so effects run. Pass `type/userId/userColor` explicitly to fix P9. Contract with T7: only the
`EditorSeam` interface from Wave 0; if T8 needs an interface change it reports it.

**T9 `lint-coverage`** (S1, S4, S5, B3) — owns `eslint.config.mjs`, `test/specs/**` *for style
only*, `src/core/annotations/**` (S4 rename `head_`→`private head`), comment cleanups (S5).
Lint `test/` and `tools/` with the repo rules (allow `max-lines` in specs); add a `lib/` policy:
lint with `no-var: off` and `max-lines: off`, everything else on, fix what that surfaces. Report
the 8 `lib/` files with no `src`/`test` references (B3) with a recommendation — deletion waits
for the A1 decision.

**T10 `emitter-dedupe`** (A3 emitters, A4) — *starts after T7 and T8 merge* — owns
`src/adapters/base-adapter.ts`, `src/editors/codemirror-adapter.ts`, `src/editors/codemirror6-adapter.ts`,
`src/adapters/offline/durable-adapter.ts` (delegation only). One typed `Emitter<Events>` in
`src/core/emitter.ts`; replace `delegateToNetwork` reflection with explicit forwarding; delete
`lib/document-engine.js`-style pass-throughs in `src/`. Behaviour-neutral: no spec changes except
imports.

## Wave 3 — Architecture decision, packaging, docs

**Decision gate (owner):** A1 — pick one:
  (a) *Freeze lib.* `lib/` is the legacy Firepad 1.x bundle, no new features; delete
      `lib/sync-seam.js` + `.d.ts` and have `tools/bundle.js` prepend an esbuild IIFE of
      `src/adapters` so `lib/firepad.js` consumes the TS seam. **Recommended.**
  (b) *Port lib.* Move the remaining OT/rich-text code into `src/` (multi-week).

**T11 `seam-unify`** (A1 per decision (a)) — owns `lib/sync-seam.js`, `lib/sync-seam.d.ts`,
`lib/agentive-presence.*`, `tools/bundle.js`, `test/specs/sync-seam.spec.js`. Bundle
`src/adapters/index.ts` with esbuild to `dist/seam.iife.js`, concatenate first; `sync-seam.spec.js`
imports from `src`. Delete the B3 files T9 confirmed dead, plus their specs.

**T12 `packaging`** (P1, P2) — *after T11* — owns `package.json` `main/exports/files/types`,
`tsconfig.build.json` (new), `tools/bundle.js` (minify step), all `src/**` relative import
specifiers. Emit `dist/esm/**/*.js` + `.d.ts` via `tsc -p tsconfig.build.json`; rewrite
`.ts`/`.tsx` import specifiers to `.js` (drop `allowImportingTsExtensions`); `exports` point at
built JS with `types`; `firepad.min.js` produced by esbuild `--minify`; verify with
`npx publint` and `npx @arethetypeswrong/cli --pack`. Touches every file — must be last code task.

**T13 `strict-mode`** (S2) — *after T12* — owns `tsconfig.json` + whatever `strict: true`
surfaces. Turn on `strict`, `noImplicitAny`; eliminate `any` in `src/core` first, then adapters.
Budget: if more than ~40 errors remain after core, stop and report a split.

**T14 `docs`** (B7, P4, P11) — parallel with T11–T13, owns `README.md`, `CONTEXT.md`,
`docs/**` (not this file), `.github/CONTRIBUTING.md`, `.github/workflows/ci-verify.yml` step
names, `src/core/README.md`. README rewritten around `@pyric/pad/*` imports, hosted Pyric dev
setup (`hosted: true`, `database.rules.json`, Node ≥22.15), no Firepad CDN sections; CI step
names without hard-coded counts; `tentativeDiff`→`ghostDiff` in CONTEXT; ADR-0001 gains
Status/Context/Decision/Consequences; ADR-0002 records the A1 decision.

## Orchestrator checklist per wave

- [ ] Spawn agents in one message with `model: "opus"`, `isolation: "worktree"`, the task block
      pasted verbatim, and the operating rules.
- [ ] On each report: confirm the red spec exists and failed before the fix (ask for the output if
      it isn't in the report); confirm no files outside the owned paths changed (`git diff --stat`).
- [ ] Merge in the stated order; run the full gate on `remediation/main`; on failure, send the
      failing output back to the owning agent (SendMessage) — don't fix it yourself.
- [ ] After Wave 2: run the hosted-mode two-client probe (`examples/pyric-studio-live.html`)
      manually and record the result in CHANGELOG.
- [ ] After Wave 3: `npm pack --dry-run`, `publint`, fresh-clone `bun install --frozen-lockfile`.
