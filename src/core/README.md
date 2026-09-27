# `@pyric/pad/core` — Zero-DOM Operational Transformation Math & Document Engine

This module contains the DOM-free Operational Transformation (OT) primitives, annotation list, and undo history for **Pyrepad**.

## 🏛️ Merge-Conflict-Resistant Architecture & Complexity Governance

To ensure autonomous coding agents and human engineers can collaborate concurrently without git merge conflicts or monolithic file bloat, `@pyric/pad/core` enforces strict architectural guardrails via ESLint 9 Flat Config (`eslint.config.mjs`):

1. **Strict 300-Line File Ceilings**: No single module exceeds 300 lines of code (`"max-lines": ["error", 300]`). Monolithic 600+ line God classes from legacy Firepad (`text-operation.js`, `annotation-list.js`) have been split into single-responsibility modules:
   - `operations/text-operation.ts` (Base document operation primitives and builder chaining)
   - `operations/composition-math.ts` (Sequential operation composition algebra)
   - `operations/transformation-math.ts` (Concurrent operation transformation)
   - `operations/apply-math.ts` (String application and attribute projection)
   - `operations/annotation-list.ts` (Rich-text span tracking linked list)
   - `operations/annotation-mutations.ts` (Linked list node mutation and splicing algorithms)
   - `history/undo-manager.ts` (Collaborative undo/redo stack transformation)
   - `emitter.ts` (Typed synchronous `Emitter<Events>` shared by the sync adapters and editor adapters; internal, not exported from `@pyric/pad/core`)
2. **Strict Function Ceilings**: Functions are capped at 60 lines (`"max-lines-per-function": ["error", 60]`) and 4 parameters (`"max-params": ["error", 4]`). Complex multi-variable calculations pass structured context interfaces (`ComposeCtx`, `TransformCtx`, `ApplyCtx`).
3. **Zero-DOM Headless Guarantee**: This module is strictly prohibited from accessing browser DOM symbols (`window`, `document`, `HTMLElement`, `navigator`). It runs on Node.js, Bun, and other non-browser runtimes without JSDOM or browser emulation.

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

`@pyric/pad/core` is covered by direct ESM specs (`test/specs/core-*.spec.js`: apply/compose/transform laws, invert, and undo/redo, including seeded random-operation loops). The rest of `test/specs/` covers the adapters, editors, React hooks, and the legacy `lib/` bundle. Run the whole suite with Bun:

```bash
PYRIC_SANDBOX=1 bun test test/specs/*.spec.js
```
