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
  if (span.end() > currentPos) {
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
  if (current === null && !isZeroLengthAtPos) {
    throw new Error("Span start exceeds the bounds of the AnnotationList.");
  }

  const startPos = currentPos;
  const start = isZeroLengthAtPos ? null : current;
  const beforeStart = prev;

  let pred: Node | null = null;
  let predPos = 0;
  let beforePred: Node | null = null;

  if (currentPos === span.pos && currentPos > 0) {
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
  if (res.pred && res.pred.annotation.equals(newSegment.annotation)) {
    includePred = true;
    newSegment.length += res.pred.length;
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
  return { includePred, includeSucc };
}

function spliceEmptySegment(
  res: AffectedNodesResult,
  tail: Node | null,
  newNodes: NewAnnotatedSpan[],
): { includePred: boolean; includeSucc: boolean } {
  if (res.pred && res.succ && res.pred.annotation.equals(res.succ.annotation)) {
    const newSegment = new Node(
      res.pred.length + res.succ.length,
      res.pred.annotation,
    );
    assert(
      res.beforePred !== null,
      "beforePred must exist when pred is defined",
    );
    res.beforePred!.next = newSegment;
    newSegment.next = res.succ.next;
    newNodes.push(
      new NewAnnotatedSpan(res.startPos - res.pred.length, newSegment),
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
  if (span.pos < 0) {
    throw new Error("Span start cannot be negative.");
  }
  if (span.length < 0) {
    throw new Error("Span length cannot be negative.");
  }
  const newNodes: NewAnnotatedSpan[] = [];
  const res = getAffectedNodes(head, span);

  let tail: Node | null;
  if (res.start !== null) {
    tail = res.end ? res.end.next : null;
    if (res.end) res.end.next = null;
  } else {
    tail = res.succ;
  }

  let newSegment: Node | null;
  try {
    newSegment = operationFn(res.startPos, res.start);
  } catch (err) {
    if (res.end && res.start !== null) {
      res.end.next = tail;
    }
    throw err;
  }

  let splicedResult: { includePred: boolean; includeSucc: boolean };
  if (newSegment !== null) {
    splicedResult = spliceNewSegment(newSegment, res, tail, newNodes);
  } else {
    splicedResult = spliceEmptySegment(res, tail, newNodes);
  }
  const { includePred, includeSucc } = splicedResult;

  const oldNodes = collectOldNodes(res, includePred, includeSucc);
  changeHandler(oldNodes, newNodes);
}
