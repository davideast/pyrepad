/**
 * Application mathematics for applying Operational Transformations to strings and rich attributes.
 */
export interface ApplyCtx {
  str: string;
  oldIndex: number;
  oldAttributes: Record<string, any>[];
  newAttributes: Record<string, any>[];
}

export function applyRetain(op: any, chars: number, ctx: ApplyCtx): string {
  if (ctx.oldIndex + chars > ctx.str.length) {
    throw new Error(
      "Operation can't retain more characters than are left in the string.",
    );
  }
  const slice = ctx.str.slice(ctx.oldIndex, ctx.oldIndex + chars);
  const attrs = op.attributes || {};
  for (let k = 0; k < chars; k++) {
    const currAttributes = ctx.oldAttributes[ctx.oldIndex + k] || {};
    const updatedAttributes: Record<string, any> = {};
    for (const attr in currAttributes) {
      updatedAttributes[attr] = currAttributes[attr];
    }
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
  op: any,
  text: string,
  newAttributes: Record<string, any>[],
): string {
  const attrs = op.attributes || {};
  for (let k = 0; k < text.length; k++) {
    const insertedAttributes: Record<string, any> = {};
    for (const attr in attrs) {
      insertedAttributes[attr] = attrs[attr];
    }
    newAttributes.push(insertedAttributes);
  }
  return text;
}
