var firepad = firepad || { };

firepad.ACEAdapter = (function() {
  'use strict';

  function ACEAdapter(aceInstance) {
    if (!(this instanceof ACEAdapter)) { return new ACEAdapter(aceInstance); }

    this.ignoreChanges = false;
    this.ace = aceInstance;
    this.aceSession = this.ace.getSession();
    this.aceDoc = this.aceSession.getDocument();
    this.aceDoc.setNewLineMode('unix');
    this.grabDocumentState();

    var self = this;
    this.onChange = function(change) {
      if (!self.ignoreChanges) {
        var pair = self.operationFromACEChange(change);
        self.trigger.apply(self, ['change'].concat(pair));
        self.grabDocumentState();
      }
    };

    this.onBlur = function() {
      if (self.ace.selection.isEmpty()) {
        self.trigger('blur');
      }
    };

    this.onFocus = function() {
      self.trigger('focus');
    };

    this.onCursorActivity = function() {
      setTimeout(function() {
        self.trigger('cursorActivity');
      }, 0);
    };

    this.ace.on('change', this.onChange);
    this.ace.on('blur', this.onBlur);
    this.ace.on('focus', this.onFocus);
    this.aceSession.selection.on('changeCursor', this.onCursorActivity);
    if (!this.aceRange) {
      var requireFn = (typeof ace !== 'undefined' && ace.require) ? ace.require : (typeof require === 'function' ? require : null);
      if (requireFn) {
        try {
          this.aceRange = requireFn("ace/range").Range;
        } catch (e) {
          // Fallback if ace/range not loadable directly
        }
      }
    }
  }

  ACEAdapter.prototype.grabDocumentState = function() {
    this.lastDocLines = this.aceDoc.getAllLines();
    this.lastCursorRange = this.aceSession.selection.getRange();
  };

  ACEAdapter.prototype.detach = function() {
    this.ace.removeListener('change', this.onChange);
    this.ace.removeListener('blur', this.onBlur);
    this.ace.removeListener('focus', this.onFocus);
    this.aceSession.selection.removeListener('changeCursor', this.onCursorActivity);
  };

  ACEAdapter.prototype.operationFromACEChange = function(change) {
    var delta, text, action, start;
    if (change.data) {
      delta = change.data;
      if (delta.action === 'insertLines' || delta.action === 'removeLines') {
        text = delta.lines.join('\n') + '\n';
        action = delta.action.replace('Lines', '');
      } else {
        text = delta.text.replace(this.aceDoc.getNewLineCharacter(), '\n');
        action = delta.action.replace('Text', '');
      }
      start = this.indexFromPos(delta.range.start);
    } else {
      text = change.lines.join('\n');
      start = this.indexFromPos(change.start);
    }

    var restLength = this.lastDocLines.join('\n').length - start;
    if (change.action === 'remove') {
      restLength -= text.length;
    }
    var insert_op = new firepad.TextOperation().retain(start).insert(text).retain(restLength);
    var delete_op = new firepad.TextOperation().retain(start).delete(text).retain(restLength);
    if (change.action === 'remove') {
      return [delete_op, insert_op];
    } else {
      return [insert_op, delete_op];
    }
  };

  ACEAdapter.prototype.applyOperationToACE = function(operation) {
    var index = 0;
    for (var i = 0; i < operation.ops.length; i++) {
      var op = operation.ops[i];
      if (op.isRetain()) {
        index += op.chars;
      } else if (op.isInsert()) {
        this.aceDoc.insert(this.posFromIndex(index), op.text);
        index += op.text.length;
      } else if (op.isDelete()) {
        var from = this.posFromIndex(index);
        var to = this.posFromIndex(index + op.chars);
        if (this.aceRange) {
          var range = this.aceRange.fromPoints(from, to);
          this.aceDoc.remove(range);
        }
      }
    }
    this.grabDocumentState();
  };

  ACEAdapter.prototype.posFromIndex = function(index) {
    var lines = this.aceDoc.$lines;
    var row = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (index <= line.length) {
        row = i;
        break;
      }
      index -= line.length + 1;
    }
    return { row: row, column: index };
  };

  ACEAdapter.prototype.indexFromPos = function(pos, lines) {
    lines = lines || this.lastDocLines;
    var index = 0;
    for (var i = 0; i < pos.row; i++) {
      index += this.lastDocLines[i].length + 1;
    }
    index += pos.column;
    return index;
  };

  ACEAdapter.prototype.getValue = function() {
    return this.aceDoc.getValue();
  };

  ACEAdapter.prototype.getCursor = function() {
    var start, end;
    try {
      start = this.indexFromPos(this.aceSession.selection.getRange().start, this.aceDoc.$lines);
      end = this.indexFromPos(this.aceSession.selection.getRange().end, this.aceDoc.$lines);
    } catch (e) {
      try {
        start = this.indexFromPos(this.lastCursorRange.start);
        end = this.indexFromPos(this.lastCursorRange.end);
      } catch (e2) {
        start = 0;
        end = 0;
      }
    }
    if (start > end) {
      var temp = start; start = end; end = temp;
    }
    return new firepad.Cursor(start, end);
  };

  ACEAdapter.prototype.setCursor = function(cursor) {
    var start = this.posFromIndex(cursor.position);
    var end = this.posFromIndex(cursor.selectionEnd);
    if (cursor.position > cursor.selectionEnd) {
      var temp = start; start = end; end = temp;
    }
    if (this.aceRange) {
      this.aceSession.selection.setSelectionRange(new this.aceRange(start.row, start.column, end.row, end.column));
    }
  };

  ACEAdapter.prototype.setOtherCursor = function(cursor, color, clientId) {
    this.otherCursors = this.otherCursors || {};
    var cursorRange = this.otherCursors[clientId];
    if (cursorRange) {
      cursorRange.start.detach();
      cursorRange.end.detach();
      this.aceSession.removeMarker(cursorRange.id);
    }
    var start = this.posFromIndex(cursor.position);
    var end = this.posFromIndex(cursor.selectionEnd);
    if (cursor.selectionEnd < cursor.position) {
      var temp = start; start = end; end = temp;
    }
    var clazz = "other-client-selection-" + color.replace('#', '');
    var justCursor = cursor.position === cursor.selectionEnd;
    if (justCursor) {
      clazz = clazz.replace('selection', 'cursor');
    }
    var css = "." + clazz + " {\n" +
      "position: absolute;\n" +
      "background-color: " + (justCursor ? 'transparent' : color) + ";\n" +
      "border-left: 2px solid " + color + ";\n" +
    "}";
    this.addStyleRule(css);
    if (!this.aceRange) return { clear: function() {} };
    
    cursorRange = new this.aceRange(start.row, start.column, end.row, end.column);
    this.otherCursors[clientId] = cursorRange;

    var self = this;
    cursorRange.clipRows = function() {
      var range = self.aceRange.prototype.clipRows.apply(this, arguments);
      range.isEmpty = function() { return false; };
      return range;
    };
    cursorRange.start = this.aceDoc.createAnchor(cursorRange.start);
    cursorRange.end = this.aceDoc.createAnchor(cursorRange.end);
    cursorRange.id = this.aceSession.addMarker(cursorRange, clazz, "text");
    
    return {
      clear: function() {
        cursorRange.start.detach();
        cursorRange.end.detach();
        self.aceSession.removeMarker(cursorRange.id);
      }
    };
  };

  ACEAdapter.prototype.addStyleRule = function(css) {
    if (typeof document === 'undefined' || !document || !document.documentElement) return;
    if (!this.addedStyleRules) {
      this.addedStyleRules = {};
      var styleElement = document.createElement('style');
      var heads = document.documentElement.getElementsByTagName('head');
      if (heads && heads[0]) {
        heads[0].appendChild(styleElement);
        this.addedStyleSheet = styleElement.sheet;
      }
    }
    if (this.addedStyleRules[css]) return;
    this.addedStyleRules[css] = true;
    if (this.addedStyleSheet && this.addedStyleSheet.insertRule) {
      try {
        this.addedStyleSheet.insertRule(css, 0);
      } catch (e) {}
    }
  };

  ACEAdapter.prototype.registerCallbacks = function(callbacks) {
    this.callbacks = callbacks;
  };

  ACEAdapter.prototype.trigger = function(event) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (this.callbacks && this.callbacks[event]) {
      this.callbacks[event].apply(this, args);
    }
  };

  ACEAdapter.prototype.applyOperation = function(operation) {
    if (!operation.isNoop()) {
      this.ignoreChanges = true;
    }
    this.applyOperationToACE(operation);
    this.ignoreChanges = false;
  };

  ACEAdapter.prototype.registerUndo = function(undoFn) {
    this.ace.undo = undoFn;
  };

  ACEAdapter.prototype.registerRedo = function(redoFn) {
    this.ace.redo = redoFn;
  };

  ACEAdapter.prototype.invertOperation = function(operation) {
    return operation.invert(this.getValue());
  };

  return ACEAdapter;
}());
