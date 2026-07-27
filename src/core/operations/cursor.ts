/**
 * A collaborative cursor with a `position` and a `selectionEnd`.
 * Both are zero-based indexes into the document.
 */
import { TextOp } from "./text-op.ts";

export class Cursor {
  position: number;
  selectionEnd: number;

  constructor(position: number, selectionEnd: number) {
    this.position = position;
    this.selectionEnd = selectionEnd;
  }

  static fromJSON(obj: { position: number; selectionEnd: number }): Cursor {
    return new Cursor(obj.position, obj.selectionEnd);
  }

  equals(other: Cursor): boolean {
    return (
      this.position === other.position &&
      this.selectionEnd === other.selectionEnd
    );
  }

  compose(other: Cursor): Cursor {
    return other;
  }

  transform(other: { ops: TextOp[] }): Cursor {
    const transformIndex = (index: number): number => {
      let newIndex = index;
      const ops = other.ops;
      for (const op of ops) {
        if (op.isRetain()) {
          index -= op.chars;
        } else if (op.isInsert()) {
          newIndex += op.text.length;
        } else {
          newIndex -= Math.min(index, op.chars);
          index -= op.chars;
        }
        const isBeforeCursor = index < 0;
        if (isBeforeCursor) {
          break;
        }
      }
      return newIndex;
    };

    const newPosition = transformIndex(this.position);
    const isCollapsedSelection = this.position === this.selectionEnd;
    if (isCollapsedSelection) {
      return new Cursor(newPosition, newPosition);
    }
    return new Cursor(newPosition, transformIndex(this.selectionEnd));
  }
}
