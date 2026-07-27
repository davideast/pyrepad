# `@pyric/pad/core` — Zero-DOM Operational Transformation Math & Document Engine

This module contains the pure mathematical Operational Transformation (OT) primitives and document state engines for **Pyrepad**.

## 🏛️ Merge-Conflict-Resistant Architecture & Complexity Governance

To ensure autonomous coding agents and human engineers can collaborate concurrently without git merge conflicts or monolithic file bloat, `@pyric/pad/core` enforces strict architectural guardrails via ESLint 9 Flat Config (`eslint.config.mjs`):

1. **Strict 300-Line File Ceilings**: No single module exceeds 300 lines of code (`"max-lines": ["error", 300]`). Monolithic 600+ line God classes from legacy Firepad (`text-operation.js`, `annotation-list.js`) have been mathematically decomposed into orthogonal, single-responsibility engines:
   - `operations/text-operation.ts` (Base document operation primitives and builder chaining)
   - `operations/composition-math.ts` (Sequential operation composition algebra)
   - `operations/transformation-math.ts` (Concurrent operation transformation matrices)
   - `operations/apply-math.ts` (String application and attribute projection)
   - `operations/annotation-list.ts` (Rich-text span tracking linked list)
   - `operations/annotation-mutations.ts` (Linked list node mutation and splicing algorithms)
   - `history/undo-manager.ts` (Collaborative undo/redo stack transformation)
2. **Strict Function Ceilings**: Functions are capped at 60 lines (`"max-lines-per-function": ["error", 60]`) and 4 parameters (`"max-params": ["error", 4]`). Complex multi-variable calculations pass structured context interfaces (`ComposeCtx`, `TransformCtx`, `ApplyCtx`).
3. **Zero-DOM Headless Guarantee**: This module is strictly prohibited from accessing browser DOM symbols (`window`, `document`, `HTMLElement`, `navigator`). This guarantees sub-millisecond initialization and execution on Node.js, Bun, Cloudflare Workers, and Pyric MCP AI servers without requiring JSDOM or browser emulation.

## 📦 Usage Example (Subpath Export)

```ts
import { TextOperation, UndoManager, VERSION } from "@pyric/pad/core";

console.log(`Initializing @pyric/pad/core v${VERSION}`);

// Construct a concurrent operation: retain 5 chars, insert text, delete 2 chars
const op1 = new TextOperation().retain(5).insert("Pyric").delete(2);
const op2 = new TextOperation().retain(5).insert("Agent");

// Transform operations concurrently
const [op1Prime, op2Prime] = TextOperation.transform(op1, op2);
```

## 🧪 Verification & Testing

Every module inside `@pyric/pad/core` is verified against 102 rigorous integration and property-based test suites running over Bun:
```bash
bun test test/specs/*.spec.js
```
All 41,100+ assertions execute in under 2 seconds.
