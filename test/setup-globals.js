const fs = require('fs');
const path = require('path');
const vm = require('vm');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="test"></div></body></html>', {
  url: 'http://localhost/'
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.Range = dom.window.Range;
global.MutationObserver = dom.window.MutationObserver || function() { this.observe = () => {}; this.disconnect = () => {}; };

if (global.Range && !global.Range.prototype.getBoundingClientRect) {
  global.Range.prototype.getBoundingClientRect = function() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 10, height: 16 };
  };
  global.Range.prototype.getClientRects = function() {
    return [{ top: 0, left: 0, right: 0, bottom: 0, width: 10, height: 16 }];
  };
}
if (global.HTMLElement && !global.HTMLElement.prototype.getBoundingClientRect) {
  global.HTMLElement.prototype.getBoundingClientRect = function() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 500, height: 500 };
  };
}

global.require = require;
global.CodeMirror = require('codemirror');
global.firebase = require('firebase');

const root = path.resolve(__dirname, '..');
function AceEditSession() {
  this._val = '';
  var self = this;
  this.doc = {
    setNewLineMode: () => {},
    getAllLines: () => self._val.split('\n'),
    getValue: () => self._val,
    setValue: (v) => { self._val = v; },
    $lines: [''],
    insert: (pos, txt) => { self._val += txt; },
    remove: () => {},
    createAnchor: () => ({ detach: () => {} }),
    getNewLineCharacter: () => '\n'
  };
  this.selection = {
    getRange: () => ({ start: { row: 0, column: 0 }, end: { row: 0, column: 0 } }),
    on: () => {},
    removeListener: () => {},
    setSelectionRange: () => {},
    isEmpty: () => true
  };
}
AceEditSession.prototype.getDocument = function() {
  return this.doc;
};
AceEditSession.prototype.removeMarker = function() {};
AceEditSession.prototype.addMarker = function() { return 'm1'; };

function AceEditor(el) {
  this.session = new AceEditSession();
  this.container = el || dom.window.document.createElement('div');
  this.selection = this.session.selection;
}
AceEditor.prototype.getSession = function() { return this.session; };
AceEditor.prototype.getValue = function() { return this.session.doc.getValue(); };
AceEditor.prototype.setValue = function(v) { return this.session.doc.setValue(v); };
AceEditor.prototype.on = function() {};
AceEditor.prototype.removeListener = function() {};
AceEditor.prototype.focus = function() {};
AceEditor.prototype.blur = function() {};
AceEditor.prototype.undo = function() {};
AceEditor.prototype.redo = function() {};

global.ace = {
  EditSession: AceEditSession,
  edit: function(el) { return new AceEditor(el); },
  require: () => ({
    Range: function(r1, c1, r2, c2) {
      this.start = { row: r1, column: c1 };
      this.end = { row: r2, column: c2 };
    }
  })
};
global.window.ace = global.ace;
global.window.CodeMirror = global.CodeMirror;
global.window.require = require;
global.monaco = global.monaco || { constructor: function(){}, Range: function(){} };

global.firepad = global.firepad || {};

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

libFiles.forEach(file => {
  const filePath = path.join(root, file);
  if (fs.existsSync(filePath)) {
    const code = fs.readFileSync(filePath, 'utf8');
    vm.runInThisContext(code, { filename: filePath });
  }
});

// Replace firebase database with Pyric Sandbox in test environment
if (process.env.PYRIC_SANDBOX === '1' || process.env.NODE_ENV === 'test' || !process.env.FIREBASE_REAL) {
  const pyricDb = firepad.PyricSandbox.createDatabase();
  const dbFn = () => pyricDb;
  dbFn.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  global.firebase = {
    initializeApp: () => {},
    database: dbFn,
    apps: [{}]
  };
  global.window.firebase = global.firebase;
}

const helpersPath = path.join(root, 'test/specs/helpers.js');
if (fs.existsSync(helpersPath)) {
  let helpersCode = fs.readFileSync(helpersPath, 'utf8');
  try {
    vm.runInThisContext(helpersCode, { filename: helpersPath });
  } catch (e) {
    if (!e.message || (!e.message.includes('already exists') && !e.message.includes('firebaseapp.com'))) {
      console.error('Error loading helpers.js:', e);
    }
  }
}
