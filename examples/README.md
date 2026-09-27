## Examples

Current examples, built against this repo's `dist/` bundle and `src/` modules:

  * [`pyric-studio-live.html`](./pyric-studio-live.html) - ES module live studio over the Pyric
  SharedWorker, with the Pyric Studio Realtime Database dashboard.
  * [`agentive-pyric-demo.html`](./agentive-pyric-demo.html) - Agentive presence and ghost diffs.
  * [`offline-indexeddb-demo.html`](./offline-indexeddb-demo.html) - Offline editing with an
  IndexedDB-backed durable adapter.
  * [`react-collaborative-demo.html`](./react-collaborative-demo.html) with
  [`react-demo-main.tsx`](./react-demo-main.tsx) - React hooks demo (run with `bun run dev`).

## Legacy examples

The original Firepad 1.x examples (CodeMirror, ACE, Monaco, rich text, user list, the Ruby
integration) live in [`legacy/`](./legacy). They target the Firepad 1.5 CDN builds, not this
package. See [`legacy/README.md`](./legacy/README.md).

## Security Rules

Example Realtime Database Security Rules to protect your data can be found in the
[`security/`](./security) directory.
