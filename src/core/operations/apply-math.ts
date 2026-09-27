/**
 * Applies a TextOperation to a string and its per-character attributes.
 */
import { TextOp, type Attributes } from "./text-op.js";

export interface ApplyCtx {
  str: string;
  oldIndex: number;
  oldAttributes: Attributes[];
  newAttributes: Attributes[];
}

export function applyRetain(op: TextOp, chars: number, ctx: ApplyCtx): string {
  if (ctx.oldIndex + chars > ctx.str.length) {
    throw new Error(
      "Operation can't retain more characters than are left in the string.",
    );
  }
  const slice = ctx.str.slice(ctx.oldIndex, ctx.oldIndex + chars);
  const attrs = op.attributes || {};
  for (let k = 0; k < chars; k++) {
    const currAttributes = ctx.oldAttributes[ctx.oldIndex + k] || {};
    const updatedAttributes: Attributes = { ...currAttributes };
    for (const attr in attrs) {
      if (attrs[attr] === false) {
        delete updatedAttributes[attr];
      } else {
        updatedAttributes[attr] = attrs[attr];
      }
    }
    ctx.newAttributes.push(updatedAttributes);
  }
  return slice;
}

export function applyInsert(
  op: TextOp,
  text: string,
  newAttributes: Attributes[],
): string {
  const attrs = op.attributes || {};
  for (let k = 0; k < text.length; k++) {
    newAttributes.push({ ...attrs });
  }
  return text;
}
