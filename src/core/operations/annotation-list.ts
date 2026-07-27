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

function collectOldNodes(
  res: any,
  includePred: boolean,
  includeSucc: boolean,
): OldAnnotatedSpan[] {
  const oldNodes: OldAnnotatedSpan[] = [];
  if (includePred && res.pred) {
    oldNodes.push(new OldAnnotatedSpan(res.predPos, res.pred));
  }
  let oldPos = res.startPos;
  let oldSegment = res.start;
  while (oldSegment !== null) {
    oldNodes.push(new OldAnnotatedSpan(oldPos, oldSegment));
    oldPos += oldSegment.length;
    oldSegment = oldSegment.next;
  }
  if (includeSucc && res.succ) {
    oldNodes.push(new OldAnnotatedSpan(oldPos, res.succ));
  }
  return oldNodes;
}

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

  insertAnnotatedSpan(span: any, annotation: any): void {
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

  removeSpan(removeSpan: any): void {
    if (removeSpan.length === 0) return;

    this.wrapOperation_(removeSpan, (oldPos: number, old: Node | null) => {
      assert(old !== null);
      const newNodes = new Node(0, NullAnnotation);
      let current = newNodes;
      if (removeSpan.pos > oldPos && old) {
        current.next = new Node(removeSpan.pos - oldPos, old.annotation);
        current = current.next;
      }

      while (old && removeSpan.end() > oldPos + old.length) {
        oldPos += old.length;
        old = old.next;
      }

      if (old) {
        const afterChars = oldPos + old.length - removeSpan.end();
        if (afterChars > 0) {
          current.next = new Node(afterChars, old.annotation);
        }
      }
      return newNodes.next;
    });
  }

  updateSpan(
    span: any,
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
    span: any,
    operationFn: (pos: number, node: Node | null) => Node | null,
  ): void {
    if (span.pos < 0) {
      throw new Error("Span start cannot be negative.");
    }
    const newNodes: NewAnnotatedSpan[] = [];
    const res = this.getAffectedNodes_(span);

    let tail: Node | null;
    if (res.start !== null) {
      tail = res.end ? res.end.next : null;
      if (res.end) res.end.next = null;
    } else {
      tail = res.succ;
    }

    let newSegment = operationFn(res.startPos, res.start);
    let includePred = false;
    let includeSucc = false;

    if (newSegment) {
      this.mergeNodesWithSameAnnotations_(newSegment);
      let newPos: number;
      if (res.pred && res.pred.annotation.equals(newSegment.annotation)) {
        includePred = true;
        newSegment.length += res.pred.length;
        if (res.beforePred) res.beforePred.next = newSegment;
        newPos = res.predPos;
      } else {
        if (res.beforeStart) res.beforeStart.next = newSegment;
        newPos = res.startPos;
      }
      while (newSegment.next) {
        newNodes.push(new NewAnnotatedSpan(newPos, newSegment));
        newPos += newSegment.length;
        newSegment = newSegment.next;
      }
      if (res.succ && res.succ.annotation.equals(newSegment.annotation)) {
        newSegment.length += res.succ.length;
        includeSucc = true;
        newSegment.next = res.succ.next;
      } else {
        newSegment.next = tail;
      }
      newNodes.push(new NewAnnotatedSpan(newPos, newSegment));
    } else {
      if (
        res.pred &&
        res.succ &&
        res.pred.annotation.equals(res.succ.annotation)
      ) {
        includePred = true;
        includeSucc = true;
        newSegment = new Node(
          res.pred.length + res.succ.length,
          res.pred.annotation,
        );
        if (res.beforePred) res.beforePred.next = newSegment;
        newSegment.next = res.succ.next;
        newNodes.push(
          new NewAnnotatedSpan(res.startPos - res.pred.length, newSegment),
        );
      } else {
        if (res.beforeStart) res.beforeStart.next = tail;
      }
    }

    const oldNodes = collectOldNodes(res, includePred, includeSucc);
    this.changeHandler_(oldNodes, newNodes);
  }

  getAffectedNodes_(span: any): any {
    const result: any = {};
    let prevprev: Node | null = null;
    let prev: Node = this.head_;
    let current: Node | null = prev.next;
    let currentPos = 0;

    while (current !== null && span.pos >= currentPos + current.length) {
      currentPos += current.length;
      prevprev = prev;
      prev = current;
      current = current.next;
    }
    if (current === null && !(span.length === 0 && span.pos === currentPos)) {
      throw new Error("Span start exceeds the bounds of the AnnotationList.");
    }

    result.startPos = currentPos;
    if (span.length === 0 && span.pos === currentPos) {
      result.start = null;
    } else {
      result.start = current;
    }
    result.beforeStart = prev;

    if (currentPos === span.pos && currentPos > 0) {
      result.pred = prev;
      result.predPos = currentPos - prev.length;
      result.beforePred = prevprev;
    } else {
      result.pred = null;
    }

    while (current !== null && span.end() > currentPos) {
      currentPos += current.length;
      prev = current;
      current = current.next;
    }
    if (span.end() > currentPos) {
      throw new Error("Span end exceeds the bounds of the AnnotationList.");
    }

    if (span.length === 0 && span.end() === currentPos) {
      result.end = null;
    } else {
      result.end = prev;
    }
    result.succ = currentPos === span.end() ? current : null;

    return result;
  }

  mergeNodesWithSameAnnotations_(list: Node | null): void {
    if (!list) return;
    let prev: Node | null = null;
    let curr: Node | null = list;
    while (curr) {
      if (prev && prev.annotation.equals(curr.annotation)) {
        prev.length += curr.length;
        prev.next = curr.next;
      } else {
        prev = curr;
      }
      curr = curr.next;
    }
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

  getAnnotatedSpansForSpan(span: any): any[] {
    if (span.length === 0) return [];
    const oldSpans: any[] = [];
    const res = this.getAffectedNodes_(span);
    let currentPos = res.startPos;
    let current = res.start;
    while (current !== null && currentPos < span.end()) {
      const start = Math.max(currentPos, span.pos);
      const end = Math.min(currentPos + current.length, span.end());
      const oldSpan: any = new Span(start, end - start);
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
