## Legacy Firepad 1.x examples

These examples are kept for reference only. They target the **Firepad 1.5 CDN builds**
(`https://firepad.io/releases/v1.5.9/...`) and the Firebase JS SDK 5.5.4 CDN script, not the
`@pyric/pad` package in this repo, and are not maintained or tested.

  * `code.html` - Code editing using CodeMirror.
  * `ace.html` - Code editing using ACE.
  * `richtext-simple.html` - Simple rich-text editing.
  * `richtext.html` - More advanced rich-text editing.
  * `userlist.html` (with `firepad-userlist.js` / `firepad-userlist.css`) - Rich-text editing with a
  list of users showing who's currently present.
  * `hammer.html` - Random-edit stress test for rich text.
  * `firepad.rb` - A Ruby script for loading the contents of a Firepad from server-side Ruby code.
  * `monaco.html` - Monaco editor; loads `monaco-editor` from `node_modules`, which is no longer a
  dependency of this repo, so it will not run without installing it separately.
