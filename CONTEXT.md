# Firepad Domain Glossary

This document defines the canonical domain vocabulary and architectural language for Firepad's 2026 agentive UI and Pyric sandbox modernization.

## Architecture & Synchronization

**SyncSeam**:
A reactive-minimal interface defining the network synchronization boundary between the Operational Transformation client and transport backends. It exposes three independent streams (`operations`, `presence`, and `agentive`) and fire-and-forget commit methods that absorb all revision tracking, retry buffering, and OT transformation inside the underlying adapter.
_Avoid_: Backend wrapper, connection layer, server adapter, monolithic callback bucket

**SyncAdapter**:
A concrete transport implementation that satisfies the `SyncSeam` interface (e.g., `PyricSandboxAdapter`, `FirestoreAdapter`, `WebSocketMcpAdapter`).
_Avoid_: Driver, client connection, network service

**LocalSandbox**:
An in-memory, local development environment (provided by `pyric/database` and `@pyric/cli/vite`) used to run, test, and simulate real-time collaborative editing without a cloud Firebase project or heavy emulators.
_Avoid_: Mock server, fake database, emulator suite

## Document & Collaboration

**DocumentEngine**:
A deep module that encapsulates abstract text operations, rich-text entity formatting, and selection transformations behind a universal editor seam.
_Avoid_: RichTextCodeMirror, text manager, editor helper

**AgentivePresence**:
An extended presence model supporting human caret coordinates alongside AI agent intent highlights, reasoning metadata, and streaming ghost diffs (`tentativeDiff`). It flows over its own dedicated stream to ensure high-frequency AI tokens never block authoritative text operations.
_Avoid_: Remote cursor, selection marker, colored caret
