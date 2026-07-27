var firepad = firepad || { };

firepad.PureFormatting = (function() {
  'use strict';

  function toAST(operation) {
    var ast = [];
    var currentLine = { type: 'line', attributes: {}, children: [] };
    ast.push(currentLine);

    if (!operation || !operation.ops) return ast;

    for (var i = 0; i < operation.ops.length; i++) {
      var op = operation.ops[i];
      if (op.isInsert()) {
        var text = op.text;
        var attrs = op.attributes || {};
        var parts = text.split('\n');
        for (var j = 0; j < parts.length; j++) {
          if (j > 0) {
            currentLine = { type: 'line', attributes: {}, children: [] };
            ast.push(currentLine);
          }
          if (parts[j].length > 0) {
            currentLine.children.push({
              type: 'text',
              text: parts[j],
              attributes: Object.assign({}, attrs)
            });
          }
        }
      }
    }
    return ast;
  }

  function fromAST(ast) {
    var op = new (firepad.TextOperation || function() { this.ops = []; this.insert = function(t, a) { this.ops.push({ text: t, attributes: a || {} }); return this; }; })();
    if (!Array.isArray(ast)) return op;

    for (var i = 0; i < ast.length; i++) {
      if (i > 0) op.insert('\n');
      var line = ast[i];
      if (line.children && line.children.length > 0) {
        for (var j = 0; j < line.children.length; j++) {
          var child = line.children[j];
          if (child && child.text) {
            if (child.attributes && Object.keys(child.attributes).length > 0) {
              op.insert(child.text, child.attributes);
            } else {
              op.insert(child.text);
            }
          }
        }
      }
    }
    return op;
  }

  function toMarkdown(operation) {
    if (!operation || !operation.ops) return '';
    var md = '';
    for (var i = 0; i < operation.ops.length; i++) {
      var op = operation.ops[i];
      if (op.isInsert()) {
        var txt = op.text;
        var attrs = op.attributes || {};
        var styled = txt;
        if (attrs.b && !txt.includes('\n')) styled = '**' + styled + '**';
        if (attrs.i && !txt.includes('\n')) styled = '_' + styled + '_';
        if (attrs['list-type'] === 'u') md += '- ' + styled;
        else if (attrs['list-type'] === 'o') md += '1. ' + styled;
        else md += styled;
      }
    }
    return md;
  }

  function fromMarkdown(markdownStr) {
    var op = new (firepad.TextOperation || function() { this.ops = []; this.insert = function(t, a) { this.ops.push({ text: t, attributes: a || {} }); return this; }; })();
    var lines = (markdownStr || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (i > 0) op.insert('\n');
      var line = lines[i];
      var attrs = {};
      if (line.indexOf('- ') === 0) {
        attrs['list-type'] = 'u';
        line = line.substring(2);
      } else if (/^\d+\.\s/.test(line)) {
        attrs['list-type'] = 'o';
        line = line.replace(/^\d+\.\s/, '');
      }

      var boldMatch = line.match(/^\*\*(.*)\*\*$/);
      if (boldMatch) {
        attrs.b = true;
        line = boldMatch[1];
      }
      var italicMatch = line.match(/^\_(.*)\_$/);
      if (italicMatch) {
        attrs.i = true;
        line = italicMatch[1];
      }

      if (Object.keys(attrs).length > 0) {
        op.insert(line, attrs);
      } else {
        op.insert(line);
      }
    }
    return op;
  }

  return {
    toAST: toAST,
    fromAST: fromAST,
    toMarkdown: toMarkdown,
    fromMarkdown: fromMarkdown
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = firepad.PureFormatting;
}
