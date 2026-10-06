# Pyrepad (`@pyric/pad`)

Pyrepad is a real-time collaborative text and code editing library: Operational Transformation (OT)
primitives, a synchronization seam over the Realtime Database, CodeMirror 5 and 6 bindings, and React
hooks. It is the successor to [Firepad](https://github.com/FirebaseExtended/firepad), rewritten as
TypeScript ES modules for the [Pyric](https://github.com/davideast/pyric) ecosystem.

## Lineage & Attribution

Pyrepad (`@pyric/pad`) is the successor to [Firepad](https://github.com/FirebaseExtended/firepad),
originally created by Firebase and Google under the MIT License, and keeps that license
([LICENSE](LICENSE)).

While Pyrepad re-engineers the synchronization seams for browser SharedWorkers, modular React
frameworks, and AI agentive ghost diffs, we gratefully acknowledge the original Firepad team for
developing the battle-tested Operational Transformation (OT) string algorithms that form our
foundation.

## Contents

- [Install](#install)
- [Modules](#modules)
  - [`@pyric/pad/core`](#pyricpadcore)
  - [`@pyric/pad/adapters`](#pyricpadadapters)
  - [`@pyric/pad/editors`](#pyricpadeditors)
  - [`@pyric/pad/react`](#pyricpadreact)
- [Legacy Firepad 1.x bundle](#legacy-firepad-1x-bundle)
- [Local development with Pyric](#local-development-with-pyric)
- [Database structure](#database-structure)
- [Repository layout](#repository-layout)
- [Contributing](#contributing)

## Install

`@pyric/pad` is not published to npm yet. Its `exports` map defines the four subpath imports
below; inside this repository the examples import the same modules from `src/`.

`firebase`, `react`, and `react-dom` are peer dependencies: install the ones you use. The CodeMirror 6
binding also needs `@codemirror/state` and `@codemirror/view`.

## Modules

The package has four subpath exports. Each one is usable on its own.

| Import | Contents |
| --- | --- |
| `@pyric/pad/core` | DOM-free OT: `TextOperation`, `Cursor`, `WrappedOperation`, `UndoManager`, `AnnotationList`, `PureFormatting` |
| `@pyric/pad/adapters` | The `SyncSeam` interface and its adapters: `FirebaseAdapter`, `PyricSandboxAdapter`, `SharedWorkerAdapter`, `OfflineDurableAdapter` |
| `@pyric/pad/editors` | Editor bindings that implement `EditorSeam`: `CodeMirror5Adapter`, `CodeMirror6Adapter`, plus remote-cursor widgets |
| `@pyric/pad/react` | `PyrepadProvider`, `usePyrepadEditor`, `useCollaborators`, `useAgentiveDiffs`, `<CollaborativeEditor />` |

Every module also exports `VERSION`. The vocabulary used below (`SyncSeam`, `EditorSeam`,
`PresenceState`, `ghostDiff`) is defined in [CONTEXT.md](CONTEXT.md).

### `@pyric/pad/core`

Pure OT math. It never touches the DOM, so it runs in Node, Bun, and workers.
See [`src/core/README.md`](src/core/README.md).

```ts
import { TextOperation } from "@pyric/pad/core";

const doc = "hello";
const a = new TextOperation().retain(5).insert(" world"); // one user appends
const b = new TextOperation().insert(">> ").retain(5);    // another prepends

const [aPrime, bPrime] = TextOperation.transform(a, b);
const merged = bPrime.apply(a.apply(doc));
console.log(merged);                                        // ">> hello world"
console.log(merged === aPrime.apply(b.apply(doc)));         // true
```

### `@pyric/pad/adapters`

A `SyncSeam` owns one document location in the Realtime Database. It exposes three async-iterable
streams (`operations`, `presence`, `agentive`) and the methods `whenReady()`, `isHistoryEmpty()`,
`commitOperation(op)`, `broadcastPresence(cursor)`, `broadcastAgentive(event)`, and `dispose()`.

`FirebaseAdapter` accepts either a namespaced reference (`firebase.database().ref(...)`) or a
modular config: a `ref` plus the `firebase/database` functions it needs.

```ts
import { initializeApp } from "firebase/app";
import {
  getDatabase, ref, child, get, set, remove, runTransaction,
  onValue, onChildAdded, onChildChanged, onChildRemoved,
} from "firebase/database";
import { FirebaseAdapter } from "@pyric/pad/adapters";

const db = getDatabase(initializeApp({ projectId: "demo-pad", databaseURL: "https://demo-pad.firebaseio.com" }));

const adapter = new FirebaseAdapter(
  {
    ref: ref(db, "pads/readme"),
    child, get, set, remove, runTransaction,
    onValue, onChildAdded, onChildChanged, onChildRemoved,
  },
  "alice",   // user id
  "#3b82f6", // cursor colour
);

await adapter.whenReady();
for await (const { author, operation } of adapter.operations) {
  console.log(author, operation.toString());
}
```

Other adapters: `PyricSandboxAdapter(ref, userId, color)` for a Pyric sandbox reference,
`SharedWorkerAdapter(ref, userId, color, port)` for cross-tab sync over a worker port, and
`OfflineDurableAdapter(network, storage?, docId?)`, which wraps any of them. It runs the OT
client, saves your unsaved edits to IndexedDB whenever they change, and after a reload rebases
them onto the history written since and replays them. Subscribe to `operations` before awaiting
`whenReady()`, which resolves once that replay is done.

Every adapter reports failures on its `errors` stream (`SyncError`: `commit-failed`,
`invalid-operation`, `reconcile-failed`, `presence-failed`, `apply-failed`) instead of throwing
or only logging. A refused write is rolled back in the editor and reported with the dropped
operation. `usePyrepadEditor` takes an `onError` callback for these.

AI agents publish their status and proposed edits on the separate `agentive` stream, so they never
delay document edits:

```ts
await adapter.broadcastAgentive({
  agentId: "copilot",
  status: "suggesting",
  ghostDiff: { text: "+ const leverage = true;" },
  explanation: "Adds the missing flag",
});
```

### `@pyric/pad/editors`

Editor adapters translate between an editor and `TextOperation`s. Wiring one to a `SyncSeam` by
hand (this is what `usePyrepadEditor` does for you):

```ts
import { EditorView } from "@codemirror/view";
import { CodeMirror6Adapter } from "@pyric/pad/editors";

const view = new EditorView({ parent: document.getElementById("editor")! });
const editor = new CodeMirror6Adapter(view);

// local edits -> database
editor.on("change", (operation) => void adapter.commitOperation(operation));
editor.on("cursor", (cursor) => cursor && void adapter.broadcastPresence(cursor));

// remote edits and cursors -> editor (skip our own commits)
(async () => {
  for await (const { author, operation } of adapter.operations) {
    if (author !== "alice") editor.applyOperation(operation);
  }
})();
(async () => {
  for await (const { userId, cursor, color } of adapter.presence) {
    if (cursor) editor.setOtherCursor({ clientId: userId, color, cursor: cursor as any });
    else editor.clearCursor(userId);
  }
})();
```

`CodeMirror5Adapter` takes a CodeMirror 5 instance and has the same interface (`EditorSeam`).

### `@pyric/pad/react`

Put a `SyncSeam` in context with `PyrepadProvider`, then bind an editor with `usePyrepadEditor`.
The hook subscribes to the adapter's streams in an effect, so typing does not re-render React.
`defaultText` seeds the shared document once, when it is empty; do not also pre-fill the editor.

```tsx
import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import {
  PyrepadProvider, usePyrepadEditor, useCollaborators, useAgentiveDiffs,
} from "@pyric/pad/react";

function Editor() {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);

  useEffect(() => {
    const v = new EditorView({ parent: host.current! });
    setView(v);
    return () => v.destroy();
  }, []);

  const { isReady } = usePyrepadEditor({
    editor: view,
    type: "cm6",
    userId: "alice",
    defaultText: "// start typing\n",
  });
  const people = useCollaborators();   // [{ userId, color, cursor, lastSeen }]
  const agents = useAgentiveDiffs();   // [{ agentId, status, ghostDiff, explanation, timestamp }]

  return (
    <>
      <p>{isReady ? "live" : "connecting"} · {people.length} here · {agents.length} agents</p>
      <div ref={host} />
    </>
  );
}

export function App({ adapter }) {
  return (
    <PyrepadProvider adapter={adapter}>
      <Editor />
    </PyrepadProvider>
  );
}
```

`type` is `"cm6"` for an `EditorView` and `"cm5"` (the default) for a CodeMirror 5 instance.
Every hook also accepts an adapter directly instead of reading it from context.
`<CollaborativeEditor adapter editor type userId defaultText>` wraps `usePyrepadEditor` and renders
a bar of collaborators and agents above its children.

## Legacy Firepad 1.x bundle

`bun run build` concatenates the frozen Firepad 1.x sources in `lib/` into `dist/firepad.js`,
`dist/firepad.min.js`, and `dist/firepad.css`. Loaded with a `<script>` tag, the bundle sets
`window.firepad` (the namespace, including `firepad.SyncSeam` and `firepad.DocumentEngine`) and
`window.Firepad` (the 1.x constructor, `Firepad.fromCodeMirror(ref, codeMirror, options)`). It is
the only way to get rich text and the Ace / Monaco bindings. It receives fixes only; see
[ADR-0002](docs/adr/0002-freeze-lib-legacy-bundle.md).

[`examples/pyric-studio-live.html`](examples/pyric-studio-live.html) uses it against a local Pyric
sandbox. The original Firepad 1.5 CDN examples are kept, unmaintained, in
[`examples/legacy/`](examples/legacy/README.md).

## Local development with Pyric

Development and tests run against [Pyric](https://github.com/davideast/pyric), a local
Firebase-compatible sandbox, instead of a cloud project ([ADR-0001](docs/adr/0001-sync-seam-and-pyric-sandbox.md)).

- **Node.js >= 22.15.** `@pyric/cli` requires it, and its hosted mode stores state with Node's
  built-in SQLite.
- **Hosted mode.** `vite.config.mjs` registers `pyric({ hosted: true })` from `@pyric/cli/vite`.
  The sandbox runs in a Node process next to the Vite server rather than in a browser SharedWorker,
  so every tab and browser context shares one database. In pages served by Vite, `firebase/*`
  imports resolve to the sandbox.
- **Rules.** `database.rules.json` holds open development rules (`".read": true, ".write": true`).
  Keep it: without a rules file Pyric denies every Realtime Database read and write.
- **Run Vite under Node.** `bun run dev` starts Vite through its Node shebang. Do not run it with
  `bun --bun`; the hosted sandbox needs the Node runtime.
- **State** is persisted in `.pyric/state/hosted/state.sqlite` (gitignored). One hosted sandbox
  can own a project directory at a time; a second one refuses to start until the first is stopped.

```bash
bun install
bun run dev                          # http://localhost:5173
bun run dev -- --port 5181 --strictPort --host 127.0.0.1   # another port
```

Open `/examples/` on the dev server for the demos (see [examples/README.md](examples/README.md)).

The unit specs run in-process against the Pyric sandbox and require `PYRIC_SANDBOX=1`:

```bash
PYRIC_SANDBOX=1 bun test test/specs/*.spec.js   # or: bun run test
bun run test:e2e:playwright                     # builds, then starts Vite on port 5188 (PW_PORT overrides)
```

## Database structure

Each document lives under one reference:

- `<document>/`
  - `users/<user id>/` - removed when the user disconnects.
    - `cursor` - the user's cursor position and selection.
    - `color` - the user's cursor colour.
  - `history/<revision id>/` - one entry per revision. The id is `A` followed by the revision
    number in base 36 (`A0`, `A1`, ...).
    - `a` - the author's user id.
    - `o` - the operation, as `TextOperation.toJSON()`.
    - `t` - the committing client's `Date.now()`, in milliseconds.
  - `agentive/<agent id>/` - latest `status`, `ghostDiff`, `explanation`, and `timestamp` for each AI agent.

## Repository layout

- `src/` - the four `@pyric/pad/*` modules (`core`, `adapters`, `editors`, `react`).
- `lib/` - frozen Firepad 1.x sources for the legacy bundle.
- `tools/bundle.js` - builds `dist/` (the legacy bundle).
- `test/specs/` - Bun unit specs; `test/e2e-playwright/` - multi-client browser specs.
- `examples/` - runnable demos; `examples/legacy/` - unmaintained Firepad 1.5 examples.
- `docs/adr/` - architecture decisions. `CONTEXT.md` - domain glossary.

## Contributing

See [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) for setup, the check that every change must
pass, and the pre-commit hook.
