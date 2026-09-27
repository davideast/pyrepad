/**
 * Node and span data structures for AnnotationList.
 */
import { Span, type Annotation } from "../span.js";

export function assert(condition: unknown, text?: string): asserts condition {
  if (!condition) {
    throw new Error(
      "AnnotationList assertion failed" + (text ? ": " + text : ""),
    );
  }
}

export const NullAnnotation: Annotation = {
  equals(): boolean {
    return false;
  },
};

export class Node {
  length: number;
  annotation: Annotation;
  attachedObject: unknown = null;
  next: Node | null = null;

  constructor(length: number, annotation: Annotation) {
    this.length = length;
    this.annotation = annotation;
  }

  clone(): Node {
    const node = new Node(this.length, this.annotation);
    node.next = this.next;
    return node;
  }
}

export class OldAnnotatedSpan {
  pos: number;
  length: number;
  annotation: Annotation;
  private attachedObject: unknown;

  constructor(pos: number, node: Node) {
    this.pos = pos;
    this.length = node.length;
    this.annotation = node.annotation;
    this.attachedObject = node.attachedObject;
  }

  getAttachedObject(): unknown {
    return this.attachedObject;
  }
}

export class NewAnnotatedSpan {
  pos: number;
  length: number;
  annotation: Annotation;
  private node: Node;

  constructor(pos: number, node: Node) {
    this.pos = pos;
    this.length = node.length;
    this.annotation = node.annotation;
    this.node = node;
  }

  attachObject(object: unknown): void {
    this.node.attachedObject = object;
  }
}

export { Span };
