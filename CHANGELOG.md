# Changelog

## Unreleased

Remediation of the whole-repo review of `main` @ 80d42ac. Finding ids refer to
`docs/REMEDIATION-PLAN.md`.

### Critical
- C1 typecheck no-op
- C2 history ack bug
- C3 React never syncs
- C4 CM6 not real
- C5 offline adapter (double commit / reentrant reconcile / silent rollback)
- C6 modular Firebase proxy

### Paper cuts
- P1 `firepad.min.js` not minified
- P2 exports point at `.ts`, `types/**` missing, hard deps
- P3 `PYRIC_SANDBOX` no-op
- P4 "102 suites" claim, 5/20 specs cover `src`
- P5 lint-staged excludes `.tsx`, prettier drift
- P6 `ReactiveStream.return()` hangs
- P7 no `onDisconnect`
- P8 `"agentive"` event never emitted
- P9 exhaustive-deps warning
- P10 `VERSION` x4
- P11 `tentativeDiff` vs `ghostDiff`

### Standards
- S1 guardrails skip `lib/`/`test/`
- S2 `strict: false` + `any`
- S3 CONTEXT "Avoid" vocabulary in code
- S4 Closure-style privates
- S5 marketing comments

### Architecture
- A1 parallel JS/TS seam (`lib/sync-seam.js` vs `src/adapters`)
- A2 hooks bypass `SyncSeam` via `as any`
- A3 duplicated presence widgets / emitters / file lists
- A4 middle men
- A5 agentive data clump
- A6 retry without backoff

### Bloat
- B1 grunt/bower/release scripts
- B2 karma/test vendor
- B3 dead `lib/` files
- B4 legacy examples
- B5 font/screenshot
- B6 unused deps
- B7 stale docs
