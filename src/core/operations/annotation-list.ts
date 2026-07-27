/**
 * Linked-list data structure tracking rich-text annotations over spans of text.
 */
import {
  assert,
  Node,
  NullAnnotation,
  OldAnnotatedSpan,
  NewAnnotatedSpan,
  Span,
} from "./annotation-node.ts";
import {
  wrapOperation,
  getAffectedNodes,
  type AffectedNodesResult,
} from "./annotation-mutations.ts";

export class AnnotationList {
  head_: Node;
  changeHandler_: (
    oldNodes: OldAnnotatedSpan[],
    newNodes: NewAnnotatedSpan[],
  ) => void;

  constructor(
    changeHandler: (
      oldNodes: OldAnnotatedSpan[],
      newNodes: NewAnnotatedSpan[],
    ) => void,
  ) {
    this.head_ = new Node(0, NullAnnotation);
    this.changeHandler_ = changeHandler;
  }

  insertAnnotatedSpan(span: Span, annotation: any): void {
    this.wrapOperation_(
      new Span(span.pos, 0),
      (oldPos: number, old: Node | null) => {
        assert(!old || old.next === null);
        const toInsert = new Node(span.length, annotation);
        if (!old) {
          return toInsert;
        } else {
          assert(span.pos > oldPos && span.pos < oldPos + old.length);
          const newNodes = new Node(0, NullAnnotation);
          newNodes.next = new Node(span.pos - oldPos, old.annotation);
          newNodes.next.next = toInsert;
          toInsert.next = new Node(
            oldPos + old.length - span.pos,
            old.annotation,
          );
          return newNodes.next;
        }
      },
    );
  }

  removeSpan(span: Span): void {
    if (span.length === 0) return;

    this.wrapOperation_(span, (oldPos: number, old: Node | null) => {
      assert(old !== null);
      const newNodes = new Node(0, NullAnnotation);
      let current = newNodes;
      if (span.pos > oldPos && old) {
        current.next = new Node(span.pos - oldPos, old.annotation);
        current = current.next;
      }

      while (old && span.end() > oldPos + old.length) {
        oldPos += old.length;
        old = old.next;
      }

      if (old) {
        const afterChars = oldPos + old.length - span.end();
        if (afterChars > 0) {
          current.next = new Node(afterChars, old.annotation);
        }
      }
      return newNodes.next;
    });
  }

  updateSpan(
    span: Span,
    updateFn: (annotation: any, length: number) => any,
  ): void {
    if (span.length === 0) return;

    this.wrapOperation_(span, (oldPos: number, old: Node | null) => {
      assert(old !== null);
      const newNodes = new Node(0, NullAnnotation);
      let current = newNodes;
      let currentPos = oldPos;

      if (old) {
        const beforeChars = span.pos - currentPos;
        assert(beforeChars < old.length);
        if (beforeChars > 0) {
          current.next = new Node(beforeChars, old.annotation);
          current = current.next;
          currentPos += current.length;
        }
      }

      while (old !== null && span.end() >= oldPos + old.length) {
        const length = oldPos + old.length - currentPos;
        current.next = new Node(length, updateFn(old.annotation, length));
        current = current.next;
        oldPos += old.length;
        old = old.next;
        currentPos = oldPos;
      }

      if (old) {
        const updateChars = span.end() - currentPos;
        if (updateChars > 0) {
          assert(updateChars < old.length);
          current.next = new Node(
            updateChars,
            updateFn(old.annotation, updateChars),
          );
          current = current.next;
          currentPos += current.length;

          current.next = new Node(
            oldPos + old.length - currentPos,
            old.annotation,
          );
        }
      }
      return newNodes.next;
    });
  }

  wrapOperation_(
    span: Span,
    operationFn: (pos: number, node: Node | null) => Node | null,
  ): void {
    wrapOperation(this.head_, span, operationFn, (o, n) =>
      this.changeHandler_(o, n),
    );
  }

  getAffectedNodes_(span: Span): AffectedNodesResult {
    return getAffectedNodes(this.head_, span);
  }

  forEach(
    callback: (length: number, annotation: any, attachedObject: any) => void,
  ): void {
    let current = this.head_.next;
    while (current !== null) {
      callback(current.length, current.annotation, current.attachedObject);
      current = current.next;
    }
  }

  getAnnotatedSpansForPos(pos: number): OldAnnotatedSpan[] {
    let currentPos = 0;
    let current = this.head_.next;
    let prev: Node | null = null;
    while (current !== null && currentPos + current.length <= pos) {
      currentPos += current.length;
      prev = current;
      current = current.next;
    }
    if (current === null && currentPos !== pos) {
      throw new Error("pos exceeds the bounds of the AnnotationList");
    }

    const res: OldAnnotatedSpan[] = [];
    if (currentPos === pos && prev) {
      res.push(new OldAnnotatedSpan(currentPos - prev.length, prev));
    }
    if (current) {
      res.push(new OldAnnotatedSpan(currentPos, current));
    }
    return res;
  }

  getAnnotatedSpansForSpan(span: Span): Span[] {
    if (span.length === 0) return [];
    const oldSpans: Span[] = [];
    const res = this.getAffectedNodes_(span);
    let currentPos = res.startPos;
    let current = res.start;
    while (current !== null && currentPos < span.end()) {
      const start = Math.max(currentPos, span.pos);
      const end = Math.min(currentPos + current.length, span.end());
      const oldSpan = new Span(start, end - start);
      oldSpan.annotation = current.annotation;
      oldSpans.push(oldSpan);

      currentPos += current.length;
      current = current.next;
    }
    return oldSpans;
  }

  count(): number {
    let count = 0;
    let current = this.head_.next;
    let prev: Node | null = null;
    while (current !== null) {
      if (prev) {
        assert(!prev.annotation.equals(current.annotation));
      }
      prev = current;
      current = current.next;
      count++;
    }
    return count;
  }
}
