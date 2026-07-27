/**
 * Manages undo and redo stacks for collaborative operations.
 */
const NORMAL_STATE = "normal";
const UNDOING_STATE = "undoing";
const REDOING_STATE = "redoing";

export class UndoManager {
  maxItems: number;
  state: string;
  dontCompose: boolean;
  undoStack: any[];
  redoStack: any[];

  constructor(maxItems = 50) {
    this.maxItems = maxItems;
    this.state = NORMAL_STATE;
    this.dontCompose = false;
    this.undoStack = [];
    this.redoStack = [];
  }

  add(operation: any, compose?: boolean): void {
    if (this.state === UNDOING_STATE) {
      this.redoStack.push(operation);
      this.dontCompose = true;
    } else if (this.state === REDOING_STATE) {
      this.undoStack.push(operation);
      this.dontCompose = true;
    } else {
      const undoStack = this.undoStack;
      if (!this.dontCompose && compose && undoStack.length > 0) {
        undoStack.push(operation.compose(undoStack.pop()));
      } else {
        undoStack.push(operation);
        if (undoStack.length > this.maxItems) {
          undoStack.shift();
        }
      }
      this.dontCompose = false;
      this.redoStack = [];
    }
  }

  transform(operation: any): void {
    const transformStack = (stack: any[], op: any): any[] => {
      const newStack = [];
      const Operation = op.constructor;
      for (let i = stack.length - 1; i >= 0; i--) {
        const pair = Operation.transform(stack[i], op);
        if (typeof pair[0].isNoop !== "function" || !pair[0].isNoop()) {
          newStack.push(pair[0]);
        }
        op = pair[1];
      }
      return newStack.reverse();
    };

    this.undoStack = transformStack(this.undoStack, operation);
    this.redoStack = transformStack(this.redoStack, operation);
  }

  performUndo(fn: (op: any) => void): void {
    this.state = UNDOING_STATE;
    if (this.undoStack.length === 0) {
      throw new Error("undo not possible");
    }
    fn(this.undoStack.pop());
    this.state = NORMAL_STATE;
  }

  performRedo(fn: (op: any) => void): void {
    this.state = REDOING_STATE;
    if (this.redoStack.length === 0) {
      throw new Error("redo not possible");
    }
    fn(this.redoStack.pop());
    this.state = NORMAL_STATE;
  }

  canUndo(): boolean {
    return this.undoStack.length !== 0;
  }

  canRedo(): boolean {
    return this.redoStack.length !== 0;
  }

  isUndoing(): boolean {
    return this.state === UNDOING_STATE;
  }

  isRedoing(): boolean {
    return this.state === REDOING_STATE;
  }
}
