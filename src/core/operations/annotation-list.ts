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
        const isTerminatedOrEmpty = old === null || old.next === null;
        assert(isTerminatedOrEmpty);
        const toInsert = new Node(span.length, annotation);
        const isListEmptyAtInsert = old === null;
        if (isListEmptyAtInsert) {
          return toInsert;
        } else {
          const isWithinExistingNode =
            span.pos > oldPos && span.pos < oldPos + old!.length;
          assert(isWithinExistingNode);
          const newNodes = new Node(0, NullAnnotation);
          newNodes.next = new Node(span.pos - oldPos, old!.annotation);
          newNodes.next.next = toInsert;
          toInsert.next = new Node(
            oldPos + old!.length - span.pos,
            old!.annotation,
          );
          return newNodes.next;
        }
      },
    );
  }

  removeSpan(span: Span): void {
    const isZeroLength = span.length === 0;
    if (isZeroLength) return;

    this.wrapOperation_(span, (oldPos: number, old: Node | null) => {
      const hasOldNode = old !== null;
      assert(hasOldNode);
      const newNodes = new Node(0, NullAnnotation);
      let current = newNodes;
      const beginsAfterOldPos = old !== null && span.pos > oldPos;
      if (beginsAfterOldPos) {
        current.next = new Node(span.pos - oldPos, old!.annotation);
        current = current.next;
      }

      while (old !== null && span.end() > oldPos + old.length) {
        oldPos += old.length;
        old = old.next;
      }

      const hasSurvivingTail = old !== null;
      if (hasSurvivingTail) {
        const afterChars = oldPos + old!.length - span.end();
        const hasSuffixAfterRemoval = afterChars > 0;
        if (hasSuffixAfterRemoval) {
          current.next = new Node(afterChars, old!.annotation);
        }
      }
      return newNodes.next;
    });
  }

  updateSpan(
    span: Span,
    updateFn: (annotation: any, length: number) => any,
  ): void {
    const isZeroLength = span.length === 0;
    if (isZeroLength) return;

    this.wrapOperation_(span, (oldPos: number, old: Node | null) => {
      const hasOldNode = old !== null;
      assert(hasOldNode);
      const newNodes = new Node(0, NullAnnotation);
      let current = newNodes;
      let currentPos = oldPos;

      const hasPrefixNode = old !== null;
      if (hasPrefixNode) {
        const beforeChars = span.pos - currentPos;
        const isBeforeLengthValid = beforeChars < old!.length;
        assert(isBeforeLengthValid);
        const hasUnmodifiedPrefix = beforeChars > 0;
        if (hasUnmodifiedPrefix) {
          current.next = new Node(beforeChars, old!.annotation);
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

      const hasSuffixNode = old !== null;
      if (hasSuffixNode) {
        const updateChars = span.end() - currentPos;
        const hasPartialNodeUpdate = updateChars > 0;
        if (hasPartialNodeUpdate) {
          const isUpdateLengthValid = updateChars < old!.length;
          assert(isUpdateLengthValid);
          current.next = new Node(
            updateChars,
            updateFn(old!.annotation, updateChars),
          );
          current = current.next;
          currentPos += current.length;

          current.next = new Node(
            oldPos + old!.length - currentPos,
            old!.annotation,
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
    const isOutOfBounds = current === null && currentPos !== pos;
    if (isOutOfBounds) {
      throw new Error("pos exceeds the bounds of the AnnotationList");
    }

    const res: OldAnnotatedSpan[] = [];
    const isAtExactBoundaryWithPrev = currentPos === pos && prev !== null;
    if (isAtExactBoundaryWithPrev) {
      res.push(new OldAnnotatedSpan(currentPos - prev!.length, prev!));
    }
    const hasCurrentNode = current !== null;
    if (hasCurrentNode) {
      res.push(new OldAnnotatedSpan(currentPos, current!));
    }
    return res;
  }

  getAnnotatedSpansForSpan(span: Span): Span[] {
    const isZeroLength = span.length === 0;
    if (isZeroLength) return [];
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
      const hasPredecessor = prev !== null;
      if (hasPredecessor) {
        const isAnnotationDistinct = !prev!.annotation.equals(
          current.annotation,
        );
        assert(isAnnotationDistinct);
      }
      prev = current;
      current = current.next;
      count++;
    }
    return count;
  }
}
