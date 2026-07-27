/**
 * Represents a span of characters in a text document.
 */
export class Span {
  pos: number;
  length: number;
  annotation: any;

  constructor(pos: number, length: number) {
    this.pos = pos;
    this.length = length;
  }

  end(): number {
    return this.pos + this.length;
  }
}
