/**
 * Linked list mutation algorithms for AnnotationList.
 */
import {
  Node,
  NullAnnotation,
  OldAnnotatedSpan,
  NewAnnotatedSpan,
} from "./annotation-node.ts";

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

export function getAffectedNodes(head: Node, span: any): any {
  const result: any = {};
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

function spliceNewSegment(
  newSegment: Node,
  res: any,
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
  return { includePred, includeSucc };
}

function spliceEmptySegment(
  res: any,
  tail: Node | null,
  newNodes: NewAnnotatedSpan[],
): { includePred: boolean; includeSucc: boolean } {
  if (res.pred && res.succ && res.pred.annotation.equals(res.succ.annotation)) {
    const newSegment = new Node(
      res.pred.length + res.succ.length,
      res.pred.annotation,
    );
    if (res.beforePred) res.beforePred.next = newSegment;
    newSegment.next = res.succ.next;
    newNodes.push(
      new NewAnnotatedSpan(res.startPos - res.pred.length, newSegment),
    );
    return { includePred: true, includeSucc: true };
  } else {
    if (res.beforeStart) res.beforeStart.next = tail;
    return { includePred: false, includeSucc: false };
  }
}

export function wrapOperation(
  head: Node,
  span: any,
  operationFn: (pos: number, node: Node | null) => Node | null,
  changeHandler: (
    oldNodes: OldAnnotatedSpan[],
    newNodes: NewAnnotatedSpan[],
  ) => void,
): void {
  if (span.pos < 0) {
    throw new Error("Span start cannot be negative.");
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

  const newSegment = operationFn(res.startPos, res.start);
  let includePred = false;
  let includeSucc = false;

  if (newSegment) {
    const spliced = spliceNewSegment(newSegment, res, tail, newNodes);
    includePred = spliced.includePred;
    includeSucc = spliced.includeSucc;
  } else {
    const spliced = spliceEmptySegment(res, tail, newNodes);
    includePred = spliced.includePred;
    includeSucc = spliced.includeSucc;
  }

  const oldNodes = collectOldNodes(res, includePred, includeSucc);
  changeHandler(oldNodes, newNodes);
}
