/**
 * Pure formatting and markdown translation without DOM dependencies.
 */
import { TextOperation } from "../operations/text-operation.ts";

export function toAST(operation: any): any[] {
  const ast: any[] = [];
  let currentLine: any = { type: "line", attributes: {}, children: [] };
  ast.push(currentLine);

  if (!operation || !operation.ops) {
    return ast;
  }

  for (let i = 0; i < operation.ops.length; i++) {
    const op = operation.ops[i];
    if (op.isInsert()) {
      const text = op.text;
      const attrs = op.attributes || {};
      const parts = text.split("\n");
      for (let j = 0; j < parts.length; j++) {
        if (j > 0) {
          currentLine = { type: "line", attributes: {}, children: [] };
          ast.push(currentLine);
        }
        if (parts[j].length > 0) {
          currentLine.children.push({
            type: "text",
            text: parts[j],
            attributes: Object.assign({}, attrs),
          });
        }
      }
    }
  }
  return ast;
}

function processASTChild(op: TextOperation, child: any): void {
  if (!child || !child.text) return;
  if (child.attributes && Object.keys(child.attributes).length > 0) {
    op.insert(child.text, child.attributes);
  } else {
    op.insert(child.text);
  }
}

export function fromAST(ast: any[]): TextOperation {
  const op = new TextOperation();
  if (!Array.isArray(ast)) {
    return op;
  }

  for (let i = 0; i < ast.length; i++) {
    if (i > 0) {
      op.insert("\n");
    }
    const line = ast[i];
    if (!line.children || line.children.length === 0) continue;
    for (let j = 0; j < line.children.length; j++) {
      processASTChild(op, line.children[j]);
    }
  }
  return op;
}

export function toMarkdown(operation: any): string {
  if (!operation || !operation.ops) {
    return "";
  }
  let md = "";
  for (let i = 0; i < operation.ops.length; i++) {
    const op = operation.ops[i];
    if (op.isInsert()) {
      const txt = op.text;
      const attrs = op.attributes || {};
      let styled = txt;
      if (attrs.b && !txt.includes("\n")) {
        styled = "**" + styled + "**";
      }
      if (attrs.i && !txt.includes("\n")) {
        styled = "_" + styled + "_";
      }
      if (attrs["list-type"] === "u") {
        md += "- " + styled;
      } else if (attrs["list-type"] === "o") {
        md += "1. " + styled;
      } else {
        md += styled;
      }
    }
  }
  return md;
}

export function fromMarkdown(markdownStr: string): TextOperation {
  const op = new TextOperation();
  const lines = (markdownStr || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      op.insert("\n");
    }
    let line = lines[i];
    const attrs: Record<string, any> = {};
    if (line.indexOf("- ") === 0) {
      attrs["list-type"] = "u";
      line = line.substring(2);
    } else if (/^\d+\.\s/.test(line)) {
      attrs["list-type"] = "o";
      line = line.replace(/^\d+\.\s/, "");
    }

    const boldMatch = line.match(/^\*\*(.*)\*\*$/);
    if (boldMatch) {
      attrs.b = true;
      line = boldMatch[1];
    }
    const italicMatch = line.match(/^\_(.*)\_$/);
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

export const PureFormatting = {
  toAST,
  fromAST,
  toMarkdown,
  fromMarkdown,
};
