/**
 * Manages undo and redo stacks for collaborative operations.
 */
import type { WrappedOperation } from "../operations/wrapped-operation.js";

export type UndoManagerState = "normal" | "undoing" | "redoing";

export interface UndoableOp<T> {
  compose(other: T): T;
  isNoop?(): boolean;
}

interface TransformableClass<T> {
  transform(op1: T, op2: T): [T, T];
}

function transformStack<T extends UndoableOp<T>>(
  stack: T[],
  operation: T,
): T[] {
  const newStack: T[] = [];
  let currentOp = operation;

  for (let i = stack.length - 1; i >= 0; i--) {
    // Dispatch through the runtime class so each operation type uses its own static transform.
    const OperationClass =
      currentOp.constructor as unknown as TransformableClass<T>;
    const pair = OperationClass.transform(stack[i], currentOp);
    const transformedOp = pair[0];

    const hasNoopDetector = typeof transformedOp.isNoop === "function";
    const isSignificantOp = !hasNoopDetector || !transformedOp.isNoop!();
    if (isSignificantOp) {
      newStack.push(transformedOp);
    }
    currentOp = pair[1];
  }
  return newStack.reverse();
}

export class UndoManager<T extends UndoableOp<T> = WrappedOperation> {
  maxItems: number;
  state: UndoManagerState;
  dontCompose: boolean;
  undoStack: T[];
  redoStack: T[];

  constructor(maxItems = 50) {
    const isValidCapacity = typeof maxItems === "number" && maxItems > 0;
    if (!isValidCapacity) {
      throw new Error("maxItems must be a positive integer.");
    }
    this.maxItems = maxItems;
    this.state = "normal";
    this.dontCompose = false;
    this.undoStack = [];
    this.redoStack = [];
  }

  add(operation: T, compose?: boolean): void {
    switch (this.state) {
      case "undoing": {
        this.redoStack.push(operation);
        this.dontCompose = true;
        break;
      }
      case "redoing": {
        this.undoStack.push(operation);
        this.dontCompose = true;
        break;
      }
      case "normal": {
        this.addNormalOperation(operation, Boolean(compose));
        break;
      }
    }
  }

  private addNormalOperation(operation: T, compose: boolean): void {
    const canComposeWithPrevious =
      !this.dontCompose && compose && this.undoStack.length > 0;

    if (canComposeWithPrevious) {
      const previousOp = this.undoStack.pop()!;
      const composedOp = operation.compose(previousOp);
      this.undoStack.push(composedOp);
    } else {
      this.undoStack.push(operation);
      const isExceedingCapacity = this.undoStack.length > this.maxItems;
      if (isExceedingCapacity) {
        this.undoStack.shift();
      }
    }
    this.dontCompose = false;
    this.redoStack = [];
  }

  transform(operation: T): void {
    this.undoStack = transformStack(this.undoStack, operation);
    this.redoStack = transformStack(this.redoStack, operation);
  }

  performUndo(fn: (op: T) => void): void {
    const isStackEmpty = this.undoStack.length === 0;
    if (isStackEmpty) {
      throw new Error("undo not possible");
    }
    this.state = "undoing";
    try {
      fn(this.undoStack.pop()!);
    } finally {
      this.state = "normal";
    }
  }

  performRedo(fn: (op: T) => void): void {
    const isStackEmpty = this.redoStack.length === 0;
    if (isStackEmpty) {
      throw new Error("redo not possible");
    }
    this.state = "redoing";
    try {
      fn(this.redoStack.pop()!);
    } finally {
      this.state = "normal";
    }
  }

  canUndo(): boolean {
    return this.undoStack.length !== 0;
  }

  canRedo(): boolean {
    return this.redoStack.length !== 0;
  }

  isUndoing(): boolean {
    return this.state === "undoing";
  }

  isRedoing(): boolean {
    return this.state === "redoing";
  }
}
