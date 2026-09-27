/**
 * Transforms two concurrent TextOperations against each other.
 */
import type { Attributes, DeleteOp, RetainOp, TextOp } from "./text-op.js";
import type { TextOperation } from "./text-operation.js";

export function transformAttributes(
  attributes1: Attributes,
  attributes2: Attributes,
): [Attributes, Attributes] {
  const attributes1prime: Attributes = {};
  const attributes2prime: Attributes = {};
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
  operation1prime: TextOperation;
  operation2prime: TextOperation;
  ops1: TextOp[];
  ops2: TextOp[];
  state: { i1: number; i2: number };
}

type OpPair = [TextOp | undefined, TextOp | undefined];

function transformRetainRetain(
  ctx: TransformCtx,
  op1: RetainOp,
  op2: RetainOp,
): OpPair {
  const attributesPrime = transformAttributes(
    op1.attributes || {},
    op2.attributes || {},
  );
  let minl: number;
  let next: OpPair;
  if (op1.chars > op2.chars) {
    minl = op2.chars;
    op1.chars -= op2.chars;
    next = [op1, ctx.ops2[ctx.state.i2++]];
  } else if (op1.chars === op2.chars) {
    minl = op2.chars;
    next = [ctx.ops1[ctx.state.i1++], ctx.ops2[ctx.state.i2++]];
  } else {
    minl = op1.chars;
    op2.chars -= op1.chars;
    next = [ctx.ops1[ctx.state.i1++], op2];
  }
  ctx.operation1prime.retain(minl, attributesPrime[0]);
  ctx.operation2prime.retain(minl, attributesPrime[1]);
  return next;
}

function transformDeleteDelete(
  ctx: TransformCtx,
  op1: DeleteOp,
  op2: DeleteOp,
): OpPair {
  if (op1.chars > op2.chars) {
    op1.chars -= op2.chars;
    return [op1, ctx.ops2[ctx.state.i2++]];
  } else if (op1.chars === op2.chars) {
    return [ctx.ops1[ctx.state.i1++], ctx.ops2[ctx.state.i2++]];
  } else {
    op2.chars -= op1.chars;
    return [ctx.ops1[ctx.state.i1++], op2];
  }
}

function transformDeleteRetain(
  ctx: TransformCtx,
  op1: DeleteOp,
  op2: RetainOp,
): OpPair {
  let minl: number;
  let next: OpPair;
  if (op1.chars > op2.chars) {
    minl = op2.chars;
    op1.chars -= op2.chars;
    next = [op1, ctx.ops2[ctx.state.i2++]];
  } else if (op1.chars === op2.chars) {
    minl = op2.chars;
    next = [ctx.ops1[ctx.state.i1++], ctx.ops2[ctx.state.i2++]];
  } else {
    minl = op1.chars;
    op2.chars -= op1.chars;
    next = [ctx.ops1[ctx.state.i1++], op2];
  }
  ctx.operation1prime.delete(minl);
  return next;
}

function transformRetainDelete(
  ctx: TransformCtx,
  op1: RetainOp,
  op2: DeleteOp,
): OpPair {
  let minl: number;
  let next: OpPair;
  if (op1.chars > op2.chars) {
    minl = op2.chars;
    op1.chars -= op2.chars;
    next = [op1, ctx.ops2[ctx.state.i2++]];
  } else if (op1.chars === op2.chars) {
    minl = op1.chars;
    next = [ctx.ops1[ctx.state.i1++], ctx.ops2[ctx.state.i2++]];
  } else {
    minl = op1.chars;
    op2.chars -= op1.chars;
    next = [ctx.ops1[ctx.state.i1++], op2];
  }
  ctx.operation2prime.delete(minl);
  return next;
}

export function transformOperations(
  operation1: TextOperation,
  operation2: TextOperation,
): [TextOperation, TextOperation] {
  if (operation1.baseLength !== operation2.baseLength) {
    throw new Error("Both operations have to have the same base length");
  }

  // Instantiate via the runtime constructors so subclasses transform to themselves.
  const Operation1 = operation1.constructor as new () => TextOperation;
  const Operation2 = operation2.constructor as new () => TextOperation;
  const operation1prime = new Operation1();
  const operation2prime = new Operation2();
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
  let op1: TextOp | undefined = ops1[state.i1++];
  let op2: TextOp | undefined = ops2[state.i2++];

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
