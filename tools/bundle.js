const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const libFiles = [
  'lib/utils.js',
  'lib/span.js',
  'lib/pyric-sandbox.js',
  'lib/sync-seam.js',
  'lib/text-op.js',
  'lib/text-operation.js',
  'lib/pure-formatting.js',
  'lib/document-engine.js',
  'lib/agentive-presence.js',
  'lib/mcp-bridge.js',
  'lib/annotation-list.js',
  'lib/cursor.js',
  'lib/firebase-adapter.js',
  'lib/rich-text-toolbar.js',
  'lib/wrapped-operation.js',
  'lib/undo-manager.js',
  'lib/client.js',
  'lib/editor-client.js',
  'lib/ace-adapter.js',
  'lib/constants.js',
  'lib/entity-manager.js',
  'lib/entity.js',
  'lib/rich-text-codemirror.js',
  'lib/rich-text-codemirror-adapter.js',
  'lib/formatting.js',
  'lib/text.js',
  'lib/line-formatting.js',
  'lib/line.js',
  'lib/parse-html.js',
  'lib/serialize-html.js',
  'lib/text-pieces-to-inserts.js',
  'lib/headless.js',
  'lib/monaco-adapter.js',
  'lib/firepad.js'
];

let bundle = '/*! Firepad Collaborative Editor - Modernized 2026 */\n(function() {\n';
libFiles.forEach(file => {
  const filePath = path.join(root, file);
  if (fs.existsSync(filePath)) {
    bundle += '\n/* --- ' + file + ' --- */\n' + fs.readFileSync(filePath, 'utf8') + '\n';
  }
});
bundle += '\nif (typeof module !== "undefined" && module.exports) { module.exports = firepad; }\n';
bundle += 'else if (typeof define === "function" && define.amd) { define([], function() { return firepad; }); }\n';
bundle += 'else if (typeof window !== "undefined") { window.Firepad = firepad.Firepad; window.firepad = firepad; }\n';
bundle += '})();\n';

fs.writeFileSync(path.join(distDir, 'firepad.js'), bundle);
if (fs.existsSync(path.join(root, 'lib/firepad.css'))) {
  fs.copyFileSync(path.join(root, 'lib/firepad.css'), path.join(distDir, 'firepad.css'));
}
fs.writeFileSync(path.join(distDir, 'firepad.min.js'), bundle);
console.log('Successfully built dist/firepad.js, dist/firepad.min.js, and dist/firepad.css!');
