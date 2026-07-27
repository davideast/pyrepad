/**
 * Node and span data structures for AnnotationList.
 */
import { Span } from "../span.ts";

export function assert(condition: unknown, text?: string): asserts condition {
  if (!condition) {
    throw new Error(
      "AnnotationList assertion failed" + (text ? ": " + text : ""),
    );
  }
}

export const NullAnnotation = {
  equals(): boolean {
    return false;
  },
};

export class Node {
  length: number;
  annotation: any;
  attachedObject: any = null;
  next: Node | null = null;

  constructor(length: number, annotation: any) {
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
  annotation: any;
  attachedObject_: any;

  constructor(pos: number, node: Node) {
    this.pos = pos;
    this.length = node.length;
    this.annotation = node.annotation;
    this.attachedObject_ = node.attachedObject;
  }

  getAttachedObject(): any {
    return this.attachedObject_;
  }
}

export class NewAnnotatedSpan {
  pos: number;
  length: number;
  annotation: any;
  node_: Node;

  constructor(pos: number, node: Node) {
    this.pos = pos;
    this.length = node.length;
    this.annotation = node.annotation;
    this.node_ = node;
  }

  attachObject(object: any): void {
    this.node_.attachedObject = object;
  }
}

export { Span };
