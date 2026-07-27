/**
 * Represents a span of characters in a text document.
 */
export interface Annotation {
  equals(other: unknown): boolean;
}

export class Span<T = any> {
  pos: number;
  length: number;
  annotation?: T;

  constructor(pos: number, length: number) {
    this.pos = pos;
    this.length = length;
  }

  end(): number {
    return this.pos + this.length;
  }
}
