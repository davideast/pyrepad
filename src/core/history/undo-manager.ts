/**
 * Manages undo and redo stacks for collaborative operations.
 */
export type UndoManagerState = "normal" | "undoing" | "redoing";

export interface UndoableOp {
  compose(other: any): any;
  isNoop?(): boolean;
  constructor: {
    transform(op1: any, op2: any): [any, any];
  };
}

function transformStack(stack: any[], operation: any): any[] {
  const newStack: any[] = [];
  let currentOp = operation;

  for (let i = stack.length - 1; i >= 0; i--) {
    const OperationClass = currentOp.constructor;
    const pair = OperationClass.transform(stack[i], currentOp);
    const transformedOp = pair[0];

    const hasNoopDetector = typeof transformedOp.isNoop === "function";
    const isSignificantOp = !hasNoopDetector || !transformedOp.isNoop();
    if (isSignificantOp) {
      newStack.push(transformedOp);
    }
    currentOp = pair[1];
  }
  return newStack.reverse();
}

export class UndoManager {
  maxItems: number;
  state: UndoManagerState;
  dontCompose: boolean;
  undoStack: any[];
  redoStack: any[];

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

  add(operation: any, compose?: boolean): void {
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

  private addNormalOperation(operation: any, compose: boolean): void {
    const canComposeWithPrevious =
      !this.dontCompose && compose && this.undoStack.length > 0;

    if (canComposeWithPrevious) {
      const previousOp = this.undoStack.pop();
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

  transform(operation: any): void {
    this.undoStack = transformStack(this.undoStack, operation);
    this.redoStack = transformStack(this.redoStack, operation);
  }

  performUndo(fn: (op: any) => void): void {
    const isStackEmpty = this.undoStack.length === 0;
    if (isStackEmpty) {
      throw new Error("undo not possible");
    }
    this.state = "undoing";
    try {
      fn(this.undoStack.pop());
    } finally {
      this.state = "normal";
    }
  }

  performRedo(fn: (op: any) => void): void {
    const isStackEmpty = this.redoStack.length === 0;
    if (isStackEmpty) {
      throw new Error("redo not possible");
    }
    this.state = "redoing";
    try {
      fn(this.redoStack.pop());
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
