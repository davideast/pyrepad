# Firepad Modernization Roadmap & PR Sequence

This roadmap breaks down the architectural modernization of Firepad into safe, incremental Pull Requests (PRs) across four major milestones. Following Martin Fowler's refactoring principles, each PR leaves the codebase in a working, verified state.

We apply our canonical domain vocabulary ([CONTEXT.md](../CONTEXT.md)) and deep module design discipline throughout the sequence.

---

## Milestone 1: Tooling Modernization & Local Sandbox Harness
**Goal**: Establish modern ES modules and build tooling, and integrate Pyric as our deterministic local development sandbox without modifying core Operational Transformation (OT) math.

### PR 1.1: Build Harness Modernization (Bun + Vite + TypeScript)
- **Scope**: Replace Grunt, Karma, and CoffeeScript (`lib/ace-adapter.coffee`) with Bun workspace scripts, Vite dev server, and TypeScript compilation. Convert CoffeeScript to clean ES6.
- **Verification Check**: 
  ```bash
  bun run build && bun test
  ```
  *Success Criteria*: All historical OT text-operation math tests pass cleanly under Bun test runner without Grunt.
- **Why Safe**: Purely mechanical build and syntax upgrade; zero runtime architecture changes.

### PR 1.2: Pyric Sandbox Integration (`@pyric/cli` + `pyric/database`)
- **Scope**: Add `~/repos/davideast/pyric` as a dev dependency. Configure `@pyric/cli/register` for automated Node integration tests and `@pyric/cli/vite` for local browser server emulation (`pyric dev`).
- **Verification Check**: 
  ```bash
  PYRIC_SANDBOX=1 bun test:integration
  ```
  *Success Criteria*: Existing `firebase-adapter.js` suite runs against an in-memory `pyric/database` instance without internet access or cloud Firebase projects.
- **Milestone 1 Deliverable**: Zero-config local collaborative editing sandbox running offline in TypeScript.

---

## Milestone 2: The Synchronization Seam & Pyric Sandbox Adapter
**Goal**: Decouple `EditorClient` from legacy Firebase Realtime Database v7 by establishing our deep **Reactive-Minimal Hybrid Seam** (`SyncSeam`).

### PR 2.1: Define `SyncSeam` & Domain Events Contract
- **Scope**: Implement TypeScript interfaces for `SyncSeam`, `TextOperation`, `PresenceState`, `AgentivePresence`, and `SyncErrorMode` in a dedicated module.
- **Verification Check**: 
  ```bash
  bun run typecheck
  ```
  *Success Criteria*: Type system validates cleanly; zero runtime code impact.

### PR 2.2: Implement `PyricSandboxAdapter` & `FirebaseRTDBAdapter`
- **Scope**: Build two concrete adapters satisfying `SyncSeam`. `PyricSandboxAdapter` wraps `pyric/database` for local testing; `FirebaseRTDBAdapter` wraps existing Firebase Realtime Database connections for backward compatibility. All revision tracking ($R_{base}$) and reconnection backoff are concentrated inside the adapters.
- **Verification Check**: 
  ```bash
  bun test:seam
  ```
  *Success Criteria*: Shared conformance test suite executes identically across both adapters, validating the reality of the seam.

### PR 2.3: Migrate `EditorClient` to Consume `SyncSeam`
- **Scope**: Refactor `EditorClient` to accept `SyncSeam` via dependency injection at the composition root. Remove ad-hoc network retry callbacks from client state.
- **Verification Check**: 
  ```bash
  bun run test:e2e:sandbox
  ```
  *Success Criteria*: Multi-client collaborative editing tests execute locally over `PyricSandboxAdapter` in milliseconds with 100% reliability.
- **Milestone 2 Deliverable**: Complete network decoupling. All cloud project test dependencies are deleted.

---

## Milestone 3: Document Engine Seam & Pure Formatting (Eliminating JSDOM)
**Goal**: Decouple rich-text formatting from CodeMirror DOM widgets and eliminate `JSDOM` in headless Node / AI agent environments.

### PR 3.1: Extract Pure Data Formatting Module
- **Scope**: Build a pure formatting pipeline that translates between abstract `TextOperation` attribute spans, Markdown AST, and structured JSON without referencing DOM nodes or `document.createElement`.
- **Verification Check**: 
  ```bash
  bun test:formatting
  ```
  *Success Criteria*: Markdown/JSON serialization and deserialization unit tests pass in <5ms without DOM polyfills.

### PR 3.2: Implement Universal `DocumentEngine` Seam
- **Scope**: Unify editor interactions behind a deep `DocumentEngine` interface (`applyOperation`, `getSelection`, `onUserChange`). Refactor `RichTextCodeMirrorAdapter` and `MonacoAdapter` to satisfy this interface.
- **Verification Check**: 
  ```bash
  pyric dev --ui
  ```
  *Success Criteria*: Rich-text collaborative editing works seamlessly across both CodeMirror and Monaco in the local Pyric studio.

### PR 3.3: Deprecate Legacy Headless & Delete JSDOM
- **Scope**: Rewrite `lib/headless.js` to rely exclusively on our pure data formatting module and `PyricSandboxAdapter`. Remove `jsdom` from `package.json`.
- **Verification Check**: 
  ```bash
  bun run test:headless:speed
  ```
  *Success Criteria*: NodeJS headless document transformations execute in <10ms per document with zero JSDOM footprint.
- **Milestone 3 Deliverable**: Clean document seam with zero browser DOM dependency in backend or AI agent pipelines.

---

## Milestone 4: 2026 Agentive Collaboration & Pyric MCP Bridge
**Goal**: Equip Firepad with native AI agent collaboration capabilities (streaming ghost diffs, reasoning highlights, and interactive MCP tool control).

### PR 4.1: Implement `AgentivePresence` & Ghost Diff Pipeline
- **Scope**: Extend `DocumentEngine` to consume `AgentivePresence.tentativeDiff` payloads from the reactive `agentive` stream. Implement OT transformation support so ghost text suggestions automatically rebase against concurrent human keystrokes.
- **Verification Check**: 
  ```bash
  bun test:ot:ghost
  ```
  *Success Criteria*: Property-based fuzz tests prove tentative ghost diffs never corrupt authoritative document state during concurrent typing storms.

### PR 4.2: Connect Pyric MCP Collaboration Bridge (`pyric dev --bridge`)
- **Scope**: Build the bridge integration that routes Pyric MCP tool interactions directly into Firepad's reactive `agentive` stream and authoritative `operations` stream.
- **Verification Check**: 
  ```bash
  bun run verify:agentive:harness
  ```
  *Success Criteria*: Automated multi-agent test harness verifies an AI coding agent streaming token-by-token refactoring diffs concurrently with simulated human editing.
- **Milestone 4 Deliverable**: Full 2026 agentive collaborative UI! Humans and AI coding agents co-edit documents seamlessly with real-time intent visualization.
