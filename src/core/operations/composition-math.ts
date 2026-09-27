/**
 * Composes two sequential TextOperations into one.
 */
import type {
  Attributes,
  DeleteOp,
  InsertOp,
  RetainOp,
  TextOp,
} from "./text-op.js";
import type { TextOperation } from "./text-operation.js";

export function composeAttributes(
  first: Attributes | null,
  second: Attributes | null,
  firstOpIsInsert?: boolean,
): Attributes {
  const merged: Attributes = {};
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
  operation: TextOperation;
  ops1: TextOp[];
  ops2: TextOp[];
  state: { i1: number; i2: number };
}

type OpPair = [TextOp | undefined, TextOp | undefined];

function handleRetainRetain(
  ctx: ComposeCtx,
  op1: RetainOp,
  op2: RetainOp,
): OpPair {
  const attributes = composeAttributes(op1.attributes, op2.attributes);
  if (op1.chars > op2.chars) {
    ctx.operation.retain(op2.chars, attributes);
    op1.chars -= op2.chars;
    return [op1, ctx.ops2[ctx.state.i2++]];
  } else if (op1.chars === op2.chars) {
    ctx.operation.retain(op1.chars, attributes);
    return [ctx.ops1[ctx.state.i1++], ctx.ops2[ctx.state.i2++]];
  } else {
    ctx.operation.retain(op1.chars, attributes);
    op2.chars -= op1.chars;
    return [ctx.ops1[ctx.state.i1++], op2];
  }
}

function handleInsertDelete(
  ctx: ComposeCtx,
  op1: InsertOp,
  op2: DeleteOp,
): OpPair {
  if (op1.text.length > op2.chars) {
    op1.text = op1.text.slice(op2.chars);
    return [op1, ctx.ops2[ctx.state.i2++]];
  } else if (op1.text.length === op2.chars) {
    return [ctx.ops1[ctx.state.i1++], ctx.ops2[ctx.state.i2++]];
  } else {
    op2.chars -= op1.text.length;
    return [ctx.ops1[ctx.state.i1++], op2];
  }
}

function handleInsertRetain(
  ctx: ComposeCtx,
  op1: InsertOp,
  op2: RetainOp,
): OpPair {
  const attributes = composeAttributes(op1.attributes, op2.attributes, true);
  if (op1.text.length > op2.chars) {
    ctx.operation.insert(op1.text.slice(0, op2.chars), attributes);
    op1.text = op1.text.slice(op2.chars);
    return [op1, ctx.ops2[ctx.state.i2++]];
  } else if (op1.text.length === op2.chars) {
    ctx.operation.insert(op1.text, attributes);
    return [ctx.ops1[ctx.state.i1++], ctx.ops2[ctx.state.i2++]];
  } else {
    ctx.operation.insert(op1.text, attributes);
    op2.chars -= op1.text.length;
    return [ctx.ops1[ctx.state.i1++], op2];
  }
}

function handleRetainDelete(
  ctx: ComposeCtx,
  op1: RetainOp,
  op2: DeleteOp,
): OpPair {
  if (op1.chars > op2.chars) {
    ctx.operation.delete(op2.chars);
    op1.chars -= op2.chars;
    return [op1, ctx.ops2[ctx.state.i2++]];
  } else if (op1.chars === op2.chars) {
    ctx.operation.delete(op2.chars);
    return [ctx.ops1[ctx.state.i1++], ctx.ops2[ctx.state.i2++]];
  } else {
    ctx.operation.delete(op1.chars);
    op2.chars -= op1.chars;
    return [ctx.ops1[ctx.state.i1++], op2];
  }
}

export function composeOperations(
  operation1: TextOperation,
  operation2: TextOperation,
): TextOperation {
  if (operation1.targetLength !== operation2.baseLength) {
    throw new Error(
      "The base length of the second operation has to be the target length of the first operation",
    );
  }
  // Instantiate via the runtime constructor so subclasses compose to themselves.
  const Operation = operation1.constructor as new () => TextOperation;
  const operation = new Operation();
  const ops1 = operation1.clone().ops;
  const ops2 = operation2.clone().ops;
  const state = { i1: 0, i2: 0 };
  const ctx: ComposeCtx = { operation, ops1, ops2, state };
  let op1: TextOp | undefined = ops1[state.i1++];
  let op2: TextOp | undefined = ops2[state.i2++];

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

function getSimpleOp(operation: TextOperation): TextOp | null {
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

function getStartIndex(operation: TextOperation): number {
  if (operation.ops[0] && operation.ops[0].isRetain()) {
    return operation.ops[0].chars;
  }
  return 0;
}

export function shouldBeComposedWith(
  opA: TextOperation,
  opB: TextOperation,
): boolean {
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

export function shouldBeComposedWithInverted(
  opA: TextOperation,
  opB: TextOperation,
): boolean {
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
