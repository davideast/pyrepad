/**
 * Composition mathematics for merging sequential Operational Transformations.
 */
import { TextOp } from "./text-op.ts";

export function composeAttributes(
  first: Record<string, any>,
  second: Record<string, any>,
  firstOpIsInsert?: boolean,
): Record<string, any> {
  const merged: Record<string, any> = {};
  for (const attr in first) {
    merged[attr] = first[attr];
  }
  for (const attr in second) {
    if (firstOpIsInsert && second[attr] === false) {
      delete merged[attr];
    } else {
      merged[attr] = second[attr];
    }
  }
  return merged;
}

interface ComposeCtx {
  operation: any;
  ops1: any[];
  ops2: any[];
  state: { i1: number; i2: number };
}

function handleRetainRetain(ctx: ComposeCtx, op1: any, op2: any): [any, any] {
  const attributes = composeAttributes(op1.attributes, op2.attributes);
  if (op1.chars > op2.chars) {
    ctx.operation.retain(op2.chars, attributes);
    op1.chars -= op2.chars;
    op2 = ctx.ops2[ctx.state.i2++];
  } else if (op1.chars === op2.chars) {
    ctx.operation.retain(op1.chars, attributes);
    op1 = ctx.ops1[ctx.state.i1++];
    op2 = ctx.ops2[ctx.state.i2++];
  } else {
    ctx.operation.retain(op1.chars, attributes);
    op2.chars -= op1.chars;
    op1 = ctx.ops1[ctx.state.i1++];
  }
  return [op1, op2];
}

function handleInsertDelete(ctx: ComposeCtx, op1: any, op2: any): [any, any] {
  if (op1.text.length > op2.chars) {
    op1.text = op1.text.slice(op2.chars);
    op2 = ctx.ops2[ctx.state.i2++];
  } else if (op1.text.length === op2.chars) {
    op1 = ctx.ops1[ctx.state.i1++];
    op2 = ctx.ops2[ctx.state.i2++];
  } else {
    op2.chars -= op1.text.length;
    op1 = ctx.ops1[ctx.state.i1++];
  }
  return [op1, op2];
}

function handleInsertRetain(ctx: ComposeCtx, op1: any, op2: any): [any, any] {
  const attributes = composeAttributes(op1.attributes, op2.attributes, true);
  if (op1.text.length > op2.chars) {
    ctx.operation.insert(op1.text.slice(0, op2.chars), attributes);
    op1.text = op1.text.slice(op2.chars);
    op2 = ctx.ops2[ctx.state.i2++];
  } else if (op1.text.length === op2.chars) {
    ctx.operation.insert(op1.text, attributes);
    op1 = ctx.ops1[ctx.state.i1++];
    op2 = ctx.ops2[ctx.state.i2++];
  } else {
    ctx.operation.insert(op1.text, attributes);
    op2.chars -= op1.text.length;
    op1 = ctx.ops1[ctx.state.i1++];
  }
  return [op1, op2];
}

function handleRetainDelete(ctx: ComposeCtx, op1: any, op2: any): [any, any] {
  if (op1.chars > op2.chars) {
    ctx.operation.delete(op2.chars);
    op1.chars -= op2.chars;
    op2 = ctx.ops2[ctx.state.i2++];
  } else if (op1.chars === op2.chars) {
    ctx.operation.delete(op2.chars);
    op1 = ctx.ops1[ctx.state.i1++];
    op2 = ctx.ops2[ctx.state.i2++];
  } else {
    ctx.operation.delete(op1.chars);
    op2.chars -= op1.chars;
    op1 = ctx.ops1[ctx.state.i1++];
  }
  return [op1, op2];
}

export function composeOperations(operation1: any, operation2: any): any {
  if (operation1.targetLength !== operation2.baseLength) {
    throw new Error(
      "The base length of the second operation has to be the target length of the first operation",
    );
  }
  const operation = new operation1.constructor();
  const ops1 = operation1.clone().ops;
  const ops2 = operation2.clone().ops;
  const state = { i1: 0, i2: 0 };
  const ctx: ComposeCtx = { operation, ops1, ops2, state };
  let op1 = ops1[state.i1++];
  let op2 = ops2[state.i2++];

  while (true) {
    if (typeof op1 === "undefined" && typeof op2 === "undefined") break;
    if (op1 && op1.isDelete()) {
      operation.delete(op1.chars);
      op1 = ops1[state.i1++];
      continue;
    }
    if (op2 && op2.isInsert()) {
      operation.insert(op2.text, op2.attributes);
      op2 = ops2[state.i2++];
      continue;
    }
    if (typeof op1 === "undefined")
      throw new Error(
        "Cannot compose operations: first operation is too short.",
      );
    if (typeof op2 === "undefined")
      throw new Error(
        "Cannot compose operations: first operation is too long.",
      );

    if (op1.isRetain() && op2.isRetain()) {
      [op1, op2] = handleRetainRetain(ctx, op1, op2);
    } else if (op1.isInsert() && op2.isDelete()) {
      [op1, op2] = handleInsertDelete(ctx, op1, op2);
    } else if (op1.isInsert() && op2.isRetain()) {
      [op1, op2] = handleInsertRetain(ctx, op1, op2);
    } else if (op1.isRetain() && op2.isDelete()) {
      [op1, op2] = handleRetainDelete(ctx, op1, op2);
    } else {
      throw new Error(
        "This shouldn't happen: op1: " +
          JSON.stringify(op1) +
          ", op2: " +
          JSON.stringify(op2),
      );
    }
  }
  return operation;
}

function getSimpleOp(operation: any): TextOp | null {
  const ops = operation.ops;
  switch (ops.length) {
    case 1:
      return ops[0];
    case 2:
      return ops[0].isRetain() ? ops[1] : ops[1].isRetain() ? ops[0] : null;
    case 3:
      if (ops[0].isRetain() && ops[2].isRetain()) {
        return ops[1];
      }
  }
  return null;
}

function getStartIndex(operation: any): number {
  if (operation.ops[0] && operation.ops[0].isRetain()) {
    return operation.ops[0].chars;
  }
  return 0;
}

export function shouldBeComposedWith(opA: any, opB: any): boolean {
  if (opA.isNoop() || opB.isNoop()) {
    return true;
  }

  const startA = getStartIndex(opA);
  const startB = getStartIndex(opB);
  const simpleA = getSimpleOp(opA);
  const simpleB = getSimpleOp(opB);
  if (!simpleA || !simpleB) {
    return false;
  }

  if (simpleA.isInsert() && simpleB.isInsert()) {
    return startA + (simpleA.text ? simpleA.text.length : 0) === startB;
  }

  if (simpleA.isDelete() && simpleB.isDelete()) {
    return startB + (simpleB.chars || 0) === startA || startA === startB;
  }

  return false;
}

export function shouldBeComposedWithInverted(opA: any, opB: any): boolean {
  if (opA.isNoop() || opB.isNoop()) {
    return true;
  }

  const startA = getStartIndex(opA);
  const startB = getStartIndex(opB);
  const simpleA = getSimpleOp(opA);
  const simpleB = getSimpleOp(opB);
  if (!simpleA || !simpleB) {
    return false;
  }

  if (simpleA.isInsert() && simpleB.isInsert()) {
    return (
      startA + (simpleA.text ? simpleA.text.length : 0) === startB ||
      startA === startB
    );
  }

  if (simpleA.isDelete() && simpleB.isDelete()) {
    return startB + (simpleB.chars || 0) === startA;
  }

  return false;
}
