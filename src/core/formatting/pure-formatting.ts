/**
 * Pure formatting and markdown translation without DOM dependencies.
 */
import { TextOperation } from "../operations/text-operation.ts";

export function toAST(operation: any): any[] {
  const ast: any[] = [];
  let currentLine: any = { type: "line", attributes: {}, children: [] };
  ast.push(currentLine);

  const isInvalidOperation = !operation || !operation.ops;
  if (isInvalidOperation) {
    return ast;
  }

  for (let i = 0; i < operation.ops.length; i++) {
    const op = operation.ops[i];
    const isInsertOp = op.isInsert();
    if (!isInsertOp) continue;

    const text = op.text;
    const attrs = op.attributes || {};
    const parts = text.split("\n");
    for (let j = 0; j < parts.length; j++) {
      const isSubsequentLine = j > 0;
      if (isSubsequentLine) {
        currentLine = { type: "line", attributes: {}, children: [] };
        ast.push(currentLine);
      }
      const hasTextContent = parts[j].length > 0;
      if (hasTextContent) {
        currentLine.children.push({
          type: "text",
          text: parts[j],
          attributes: Object.assign({}, attrs),
        });
      }
    }
  }
  return ast;
}

function processASTChild(op: TextOperation, child: any): void {
  const hasValidText = Boolean(child && child.text);
  if (!hasValidText) return;

  const hasAttributes = Boolean(
    child.attributes && Object.keys(child.attributes).length > 0,
  );
  if (hasAttributes) {
    op.insert(child.text, child.attributes);
  } else {
    op.insert(child.text);
  }
}

export function fromAST(ast: any[]): TextOperation {
  const op = new TextOperation();
  const isValidAST = Array.isArray(ast);
  if (!isValidAST) {
    return op;
  }

  for (let i = 0; i < ast.length; i++) {
    const isSubsequentLine = i > 0;
    if (isSubsequentLine) {
      op.insert("\n");
    }
    const line = ast[i];
    const hasChildren = Boolean(line.children && line.children.length > 0);
    if (!hasChildren) continue;
    for (let j = 0; j < line.children.length; j++) {
      processASTChild(op, line.children[j]);
    }
  }
  return op;
}

export function toMarkdown(operation: any): string {
  const isInvalidOperation = !operation || !operation.ops;
  if (isInvalidOperation) {
    return "";
  }
  let md = "";
  for (let i = 0; i < operation.ops.length; i++) {
    const op = operation.ops[i];
    const isInsertOp = op.isInsert();
    if (!isInsertOp) continue;

    const txt = op.text;
    const attrs = op.attributes || {};
    let styled = txt;

    const isSingleLineBold = Boolean(attrs.b && !txt.includes("\n"));
    if (isSingleLineBold) {
      styled = "**" + styled + "**";
    }

    const isSingleLineItalic = Boolean(attrs.i && !txt.includes("\n"));
    if (isSingleLineItalic) {
      styled = "_" + styled + "_";
    }

    const listType = attrs["list-type"] as "u" | "o" | undefined;
    switch (listType) {
      case "u": {
        md += "- " + styled;
        break;
      }
      case "o": {
        md += "1. " + styled;
        break;
      }
      default: {
        md += styled;
        break;
      }
    }
  }
  return md;
}

interface BlockParseResult {
  blockType: "u" | "o" | "text";
  strippedLine: string;
}

function parseBlockPrefix(line: string): BlockParseResult {
  const isUnordered = line.startsWith("- ");
  if (isUnordered) {
    return { blockType: "u", strippedLine: line.slice(2) };
  }

  const dotIndex = line.indexOf(". ");
  const hasPossibleOrderedPrefix = dotIndex > 0 && dotIndex <= 6;
  if (hasPossibleOrderedPrefix) {
    const prefix = line.slice(0, dotIndex);
    const isAllDigits = [...prefix].every((ch) => ch >= "0" && ch <= "9");
    if (isAllDigits) {
      return { blockType: "o", strippedLine: line.slice(dotIndex + 2) };
    }
  }

  return { blockType: "text", strippedLine: line };
}

function parseInlineStyles(
  content: string,
  attrs: Record<string, any>,
): string {
  let text = content;
  const hasMinBoldLength = text.length >= 4;
  const isBoldWrapped =
    hasMinBoldLength && text.startsWith("**") && text.endsWith("**");
  if (isBoldWrapped) {
    attrs.b = true;
    text = text.slice(2, -2);
  }

  const hasMinItalicLength = text.length >= 2;
  const isItalicWrapped =
    hasMinItalicLength && text.startsWith("_") && text.endsWith("_");
  if (isItalicWrapped) {
    attrs.i = true;
    text = text.slice(1, -1);
  }

  return text;
}

export function fromMarkdown(markdownStr: string): TextOperation {
  const op = new TextOperation();
  const lines = (markdownStr || "").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const isSubsequentLine = i > 0;
    if (isSubsequentLine) {
      op.insert("\n");
    }

    const attrs: Record<string, any> = {};
    const blockResult = parseBlockPrefix(lines[i]);

    switch (blockResult.blockType) {
      case "u": {
        attrs["list-type"] = "u";
        break;
      }
      case "o": {
        attrs["list-type"] = "o";
        break;
      }
      case "text": {
        break;
      }
    }

    const content = parseInlineStyles(blockResult.strippedLine, attrs);

    const hasExtractedAttributes = Object.keys(attrs).length > 0;
    if (hasExtractedAttributes) {
      op.insert(content, attrs);
    } else {
      op.insert(content);
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
