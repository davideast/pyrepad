/**
 * Linked list mutation algorithms for AnnotationList.
 */
import {
  assert,
  Node,
  NullAnnotation,
  OldAnnotatedSpan,
  NewAnnotatedSpan,
  Span,
} from "./annotation-node.ts";

export interface AffectedNodesResult {
  startPos: number;
  start: Node | null;
  beforeStart: Node;
  pred: Node | null;
  predPos: number;
  beforePred: Node | null;
  end: Node | null;
  succ: Node | null;
}

export function mergeNodesWithSameAnnotations(list: Node | null): void {
  const isListEmpty = list === null;
  if (isListEmpty) return;
  let prev: Node | null = null;
  let curr: Node | null = list;
  while (curr !== null) {
    const canMergeWithPrevious =
      prev !== null && prev.annotation.equals(curr.annotation);
    if (canMergeWithPrevious) {
      prev!.length += curr.length;
      prev!.next = curr.next;
    } else {
      prev = curr;
    }
    curr = curr.next;
  }
}

function findSpanEndBounds(
  startNode: Node | null,
  startPos: number,
  startPrev: Node,
  span: Span,
): { end: Node | null; succ: Node | null } {
  let current = startNode;
  let currentPos = startPos;
  let prev = startPrev;

  while (current !== null && span.end() > currentPos) {
    currentPos += current.length;
    prev = current;
    current = current.next;
  }
  const isSpanEndOutOfBounds = span.end() > currentPos;
  if (isSpanEndOutOfBounds) {
    throw new Error("Span end exceeds the bounds of the AnnotationList.");
  }

  const isZeroLengthAtPos = span.length === 0 && span.end() === currentPos;
  return {
    end: isZeroLengthAtPos ? null : prev,
    succ: currentPos === span.end() ? current : null,
  };
}

export function getAffectedNodes(head: Node, span: Span): AffectedNodesResult {
  let prevprev: Node | null = null;
  let prev: Node = head;
  let current: Node | null = prev.next;
  let currentPos = 0;

  while (current !== null && span.pos >= currentPos + current.length) {
    currentPos += current.length;
    prevprev = prev;
    prev = current;
    current = current.next;
  }
  const isZeroLengthAtPos = span.length === 0 && span.pos === currentPos;
  const isSpanStartOutOfBounds = current === null && !isZeroLengthAtPos;
  if (isSpanStartOutOfBounds) {
    throw new Error("Span start exceeds the bounds of the AnnotationList.");
  }

  const startPos = currentPos;
  const start = isZeroLengthAtPos ? null : current;
  const beforeStart = prev;

  let pred: Node | null = null;
  let predPos = 0;
  let beforePred: Node | null = null;

  const hasPredecessorNode = currentPos === span.pos && currentPos > 0;
  if (hasPredecessorNode) {
    pred = prev;
    predPos = currentPos - prev.length;
    beforePred = prevprev;
  }

  const { end, succ } = findSpanEndBounds(current, currentPos, prev, span);

  return {
    startPos,
    start,
    beforeStart,
    pred,
    predPos,
    beforePred,
    end,
    succ,
  };
}

function collectOldNodes(
  res: AffectedNodesResult,
  includePred: boolean,
  includeSucc: boolean,
): OldAnnotatedSpan[] {
  const oldNodes: OldAnnotatedSpan[] = [];
  const shouldIncludePred = includePred && res.pred !== null;
  if (shouldIncludePred) {
    oldNodes.push(new OldAnnotatedSpan(res.predPos, res.pred!));
  }
  let oldPos = res.startPos;
  let oldSegment = res.start;
  while (oldSegment !== null) {
    oldNodes.push(new OldAnnotatedSpan(oldPos, oldSegment));
    oldPos += oldSegment.length;
    oldSegment = oldSegment.next;
  }
  const shouldIncludeSucc = includeSucc && res.succ !== null;
  if (shouldIncludeSucc) {
    oldNodes.push(new OldAnnotatedSpan(oldPos, res.succ!));
  }
  return oldNodes;
}

function spliceNewSegment(
  newSegment: Node,
  res: AffectedNodesResult,
  tail: Node | null,
  newNodes: NewAnnotatedSpan[],
): { includePred: boolean; includeSucc: boolean } {
  mergeNodesWithSameAnnotations(newSegment);
  let newPos: number;
  let includePred = false;
  let includeSucc = false;
  const matchesPredAnnotation =
    res.pred !== null && res.pred.annotation.equals(newSegment.annotation);
  if (matchesPredAnnotation) {
    includePred = true;
    newSegment.length += res.pred!.length;
    assert(
      res.beforePred !== null,
      "beforePred must exist when pred is defined",
    );
    res.beforePred!.next = newSegment;
    newPos = res.predPos;
  } else {
    res.beforeStart.next = newSegment;
    newPos = res.startPos;
  }
  while (newSegment.next !== null) {
    newNodes.push(new NewAnnotatedSpan(newPos, newSegment));
    newPos += newSegment.length;
    newSegment = newSegment.next;
  }
  const matchesSuccAnnotation =
    res.succ !== null && res.succ.annotation.equals(newSegment.annotation);
  if (matchesSuccAnnotation) {
    newSegment.length += res.succ!.length;
    includeSucc = true;
    newSegment.next = res.succ!.next;
  } else {
    newSegment.next = tail;
  }
  newNodes.push(new NewAnnotatedSpan(newPos, newSegment));
  return { includePred, includeSucc };
}

function spliceEmptySegment(
  res: AffectedNodesResult,
  tail: Node | null,
  newNodes: NewAnnotatedSpan[],
): { includePred: boolean; includeSucc: boolean } {
  const canBridgeSurroundingNodes =
    res.pred !== null &&
    res.succ !== null &&
    res.pred.annotation.equals(res.succ.annotation);
  if (canBridgeSurroundingNodes) {
    const newSegment = new Node(
      res.pred!.length + res.succ!.length,
      res.pred!.annotation,
    );
    assert(
      res.beforePred !== null,
      "beforePred must exist when pred is defined",
    );
    res.beforePred!.next = newSegment;
    newSegment.next = res.succ!.next;
    newNodes.push(
      new NewAnnotatedSpan(res.startPos - res.pred!.length, newSegment),
    );
    return { includePred: true, includeSucc: true };
  } else {
    res.beforeStart.next = tail;
    return { includePred: false, includeSucc: false };
  }
}

export function wrapOperation(
  head: Node,
  span: Span,
  operationFn: (pos: number, node: Node | null) => Node | null,
  changeHandler: (
    oldNodes: OldAnnotatedSpan[],
    newNodes: NewAnnotatedSpan[],
  ) => void,
): void {
  const isNegativeStart = span.pos < 0;
  if (isNegativeStart) {
    throw new Error("Span start cannot be negative.");
  }
  const isNegativeLength = span.length < 0;
  if (isNegativeLength) {
    throw new Error("Span length cannot be negative.");
  }
  const newNodes: NewAnnotatedSpan[] = [];
  const res = getAffectedNodes(head, span);

  let tail: Node | null;
  const hasAffectedStart = res.start !== null;
  if (hasAffectedStart) {
    const hasEndNode = res.end !== null;
    tail = hasEndNode ? res.end!.next : null;
    if (hasEndNode) res.end!.next = null;
  } else {
    tail = res.succ;
  }

  let newSegment: Node | null;
  try {
    newSegment = operationFn(res.startPos, res.start);
  } catch (err) {
    const shouldRestoreTail = res.end !== null && res.start !== null;
    if (shouldRestoreTail) {
      res.end!.next = tail;
    }
    throw err;
  }

  let splicedResult: { includePred: boolean; includeSucc: boolean };
  const hasNewSegment = newSegment !== null;
  if (hasNewSegment) {
    splicedResult = spliceNewSegment(newSegment!, res, tail, newNodes);
  } else {
    splicedResult = spliceEmptySegment(res, tail, newNodes);
  }
  const { includePred, includeSucc } = splicedResult;

  const oldNodes = collectOldNodes(res, includePred, includeSucc);
  changeHandler(oldNodes, newNodes);
}
