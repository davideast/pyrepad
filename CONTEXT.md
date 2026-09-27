# Pyrepad Domain Glossary

This document defines the canonical domain vocabulary for Pyrepad (`@pyric/pad`), the successor to
Firepad, and maps each term to the code that implements it.

## Architecture & Synchronization

**SyncSeam**:
A reactive-minimal interface defining the network synchronization boundary between the Operational Transformation client and transport backends. It exposes three independent streams (`operations`, `presence`, and `agentive`) and commit/broadcast methods that absorb all revision tracking, retry buffering, and OT transformation inside the underlying adapter. Code: `SyncSeam` in `src/adapters/types.ts`.
_Avoid_: Backend wrapper, connection layer, server adapter, monolithic callback bucket

**SyncAdapter**:
A concrete transport implementation that satisfies the `SyncSeam` interface. Code: `PyricSandboxAdapter`, `FirebaseAdapter` (also exported as `FirebaseModularAdapter`), and `SharedWorkerAdapter`, all built on `AbstractSyncAdapter`; `OfflineDurableAdapter` wraps one of them with an offline revision queue.
_Avoid_: Driver, client connection, network service

**LocalSandbox**:
An in-memory, local development environment (provided by `pyric/database` and `@pyric/cli/vite`) used to run, test, and simulate real-time collaborative editing without a cloud Firebase project or heavy emulators.
_Avoid_: Mock server, fake database, emulator suite

## Document & Collaboration

**EditorSeam**:
The interface an editor adapter satisfies so a `SyncSeam` can drive it: apply remote operations, emit local `change` and `cursor` events, and draw other users' cursors. Code: `EditorSeam` in `src/editors/types.ts`, implemented by `CodeMirror5Adapter` and `CodeMirror6Adapter`. When no DOM is available, presence widgets fall back to `FallbackElement` / `FallbackStyle` (`src/editors/presence-widget-base.ts`).
_Avoid_: EditorDriverSeam, editor driver, `Mock*` for the DOM fallbacks

**DocumentEngine**:
The legacy Firepad 1.x class (`firepad.DocumentEngine`, `lib/document-engine.js`) that encapsulates text operations, rich-text formatting, and selection transformations for the `lib/` bundle. In `src/`, the same role is split between `@pyric/pad/core` (operations) and `EditorSeam` (editor binding).
_Avoid_: RichTextCodeMirror, text manager, editor helper

**PresenceState**:
One remote user's cursor as handed to an editor adapter: position, selection end, color, and client id. Code: `PresenceState` in `src/editors/types.ts`; the network-side event is `PresenceEvent` in `src/adapters/types.ts`.
_Avoid_: RemoteCursorData

**AgentivePresence**:
An extended presence model supporting human caret coordinates alongside AI agent intent highlights, reasoning metadata, and streaming ghost diffs (`ghostDiff`). It flows over its own dedicated stream to ensure high-frequency AI tokens never block authoritative text operations. Code: `AgentivePresenceEvent` in `src/adapters/types.ts`, sent with `SyncSeam.broadcastAgentive(event)`.
_Avoid_: Remote cursor, selection marker, colored caret, tentativeDiff
