/**
 * Transformation mathematics for concurrent Operational Transformations.
 */
export function transformAttributes(
  attributes1: Record<string, any>,
  attributes2: Record<string, any>,
): [Record<string, any>, Record<string, any>] {
  const attributes1prime: Record<string, any> = {};
  const attributes2prime: Record<string, any> = {};
  const allAttrs: Record<string, boolean> = {};
  for (const attr in attributes1) {
    allAttrs[attr] = true;
  }
  for (const attr in attributes2) {
    allAttrs[attr] = true;
  }

  for (const attr in allAttrs) {
    const attr1 = attributes1[attr];
    const attr2 = attributes2[attr];
    if (attr1 == null && attr2 == null) {
      continue;
    }
    if (attr1 == null) {
      attributes2prime[attr] = attr2;
    } else if (attr2 == null) {
      attributes1prime[attr] = attr1;
    } else if (attr1 === attr2) {
      // Both set it to the same value.
    } else {
      attributes1prime[attr] = attr1;
    }
  }
  return [attributes1prime, attributes2prime];
}

interface TransformCtx {
  operation1prime: any;
  operation2prime: any;
  ops1: any[];
  ops2: any[];
  state: { i1: number; i2: number };
}

function transformRetainRetain(
  ctx: TransformCtx,
  op1: any,
  op2: any,
): [any, any] {
  const attributesPrime = transformAttributes(
    op1.attributes || {},
    op2.attributes || {},
  );
  let minl: number;
  if (op1.chars > op2.chars) {
    minl = op2.chars;
    op1.chars -= op2.chars;
    op2 = ctx.ops2[ctx.state.i2++];
  } else if (op1.chars === op2.chars) {
    minl = op2.chars;
    op1 = ctx.ops1[ctx.state.i1++];
    op2 = ctx.ops2[ctx.state.i2++];
  } else {
    minl = op1.chars;
    op2.chars -= op1.chars;
    op1 = ctx.ops1[ctx.state.i1++];
  }
  ctx.operation1prime.retain(minl, attributesPrime[0]);
  ctx.operation2prime.retain(minl, attributesPrime[1]);
  return [op1, op2];
}

function transformDeleteDelete(
  ctx: TransformCtx,
  op1: any,
  op2: any,
): [any, any] {
  if (op1.chars > op2.chars) {
    op1.chars -= op2.chars;
    op2 = ctx.ops2[ctx.state.i2++];
  } else if (op1.chars === op2.chars) {
    op1 = ctx.ops1[ctx.state.i1++];
    op2 = ctx.ops2[ctx.state.i2++];
  } else {
    op2.chars -= op1.chars;
    op1 = ctx.ops1[ctx.state.i1++];
  }
  return [op1, op2];
}

function transformDeleteRetain(
  ctx: TransformCtx,
  op1: any,
  op2: any,
): [any, any] {
  let minl: number;
  if (op1.chars > op2.chars) {
    minl = op2.chars;
    op1.chars -= op2.chars;
    op2 = ctx.ops2[ctx.state.i2++];
  } else if (op1.chars === op2.chars) {
    minl = op2.chars;
    op1 = ctx.ops1[ctx.state.i1++];
    op2 = ctx.ops2[ctx.state.i2++];
  } else {
    minl = op1.chars;
    op2.chars -= op1.chars;
    op1 = ctx.ops1[ctx.state.i1++];
  }
  ctx.operation1prime.delete(minl);
  return [op1, op2];
}

function transformRetainDelete(
  ctx: TransformCtx,
  op1: any,
  op2: any,
): [any, any] {
  let minl: number;
  if (op1.chars > op2.chars) {
    minl = op2.chars;
    op1.chars -= op2.chars;
    op2 = ctx.ops2[ctx.state.i2++];
  } else if (op1.chars === op2.chars) {
    minl = op1.chars;
    op1 = ctx.ops1[ctx.state.i1++];
    op2 = ctx.ops2[ctx.state.i2++];
  } else {
    minl = op1.chars;
    op2.chars -= op1.chars;
    op1 = ctx.ops1[ctx.state.i1++];
  }
  ctx.operation2prime.delete(minl);
  return [op1, op2];
}

export function transformOperations(
  operation1: any,
  operation2: any,
): [any, any] {
  if (operation1.baseLength !== operation2.baseLength) {
    throw new Error("Both operations have to have the same base length");
  }

  const operation1prime = new operation1.constructor();
  const operation2prime = new operation2.constructor();
  const ops1 = operation1.clone().ops;
  const ops2 = operation2.clone().ops;
  const state = { i1: 0, i2: 0 };
  const ctx: TransformCtx = {
    operation1prime,
    operation2prime,
    ops1,
    ops2,
    state,
  };
  let op1 = ops1[state.i1++];
  let op2 = ops2[state.i2++];

  while (true) {
    if (typeof op1 === "undefined" && typeof op2 === "undefined") break;
    if (op1 && op1.isInsert()) {
      operation1prime.insert(op1.text, op1.attributes);
      operation2prime.retain(op1.text.length);
      op1 = ops1[state.i1++];
      continue;
    }
    if (op2 && op2.isInsert()) {
      operation1prime.retain(op2.text.length);
      operation2prime.insert(op2.text, op2.attributes);
      op2 = ops2[state.i2++];
      continue;
    }
    if (typeof op1 === "undefined")
      throw new Error(
        "Cannot transform operations: first operation is too short.",
      );
    if (typeof op2 === "undefined")
      throw new Error(
        "Cannot transform operations: first operation is too long.",
      );

    if (op1.isRetain() && op2.isRetain()) {
      [op1, op2] = transformRetainRetain(ctx, op1, op2);
    } else if (op1.isDelete() && op2.isDelete()) {
      [op1, op2] = transformDeleteDelete(ctx, op1, op2);
    } else if (op1.isDelete() && op2.isRetain()) {
      [op1, op2] = transformDeleteRetain(ctx, op1, op2);
    } else if (op1.isRetain() && op2.isDelete()) {
      [op1, op2] = transformRetainDelete(ctx, op1, op2);
    } else {
      throw new Error("The two operations aren't compatible");
    }
  }
  return [operation1prime, operation2prime];
}
