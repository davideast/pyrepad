# ADR-0001: Decouple synchronization behind a Reactive-Minimal Hybrid Seam and adopt Pyric for local sandbox testing

## Status

Accepted (2026-07-27).

## Context

Firepad's `EditorClient` (`lib/editor-client.js`) talked directly to Firebase Realtime Database v7
through `lib/firebase-adapter.js`. Every test and every local run needed either a cloud Firebase
project or hand-written network mocks, and those mocks were fragile. The planned AI features add a
second, high-frequency traffic class (agent status and ghost diffs) that must not queue behind
authoritative text edits.

## Decision

Decouple `EditorClient` from Firebase Realtime Database v7 by introducing a **Reactive-Minimal
Hybrid Seam** (`SyncSeam`, `src/adapters/types.ts`). This deep interface exposes three independent
streams (`operations`, `presence`, and `agentive`) so that high-frequency AI ghost diffs never block
authoritative text edits, while its commit methods absorb all OT revision tracking, retry
buffering, and rollback reconciliation inside the transport adapter.

Adopt Pyric (`pyric/database` and `@pyric/cli`) as the exclusive local development sandbox and
offline verification engine, replacing cloud-only project dependencies and heavy emulator suites
with an in-memory TypeScript runtime.

## Consequences

- Transports are interchangeable behind `SyncSeam`: `PyricSandboxAdapter`, `FirebaseAdapter`,
  `SharedWorkerAdapter`, and the `OfflineDurableAdapter` wrapper all satisfy it, and the React
  hooks in `@pyric/pad/react` consume only its streams.
- Tests run against the Pyric sandbox with no cloud project; `PYRIC_SANDBOX=1` is required by
  `test/setup-globals.js`.
- Local development runs Pyric through the `@pyric/cli/vite` plugin. That brings Pyric's own
  requirements with it (Node >= 22.15 for the hosted mode, and a `database.rules.json`, because
  Pyric denies all Realtime Database access when no rules are loaded).
- Two seam implementations existed for a while (`lib/sync-seam.js` and `src/adapters`); ADR-0002
  records how that is resolved.
