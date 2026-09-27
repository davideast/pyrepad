const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const { SEAM_BUILD_OPTIONS, LIB_FILES } = require('./lib-files.js');

const seamFile = path.join(distDir, 'seam.iife.js');
esbuild.buildSync({ ...SEAM_BUILD_OPTIONS, outfile: seamFile });

let bundle = '/*! Firepad Collaborative Editor - Modernized 2026 */\n(function() {\n';
bundle += '\n/* --- dist/seam.iife.js (src/adapters) --- */\n' + fs.readFileSync(seamFile, 'utf8') + '\n';
LIB_FILES.forEach(file => {
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
// P1: a real minification of the same bundle; `/*!` legal comments are kept.
const minified = esbuild.transformSync(bundle, { minify: true, legalComments: 'inline', logLevel: 'silent' });
fs.writeFileSync(path.join(distDir, 'firepad.min.js'), minified.code);
console.log('Successfully built dist/seam.iife.js, dist/firepad.js, dist/firepad.min.js, and dist/firepad.css!');
