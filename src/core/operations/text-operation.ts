/**
 * Operational Transformation text document operation.
 */
import { TextOp, type Attributes } from "./text-op.js";
import {
  composeOperations,
  shouldBeComposedWith,
  shouldBeComposedWithInverted,
} from "./composition-math.js";
import {
  transformAttributes,
  transformOperations,
} from "./transformation-math.js";
import { applyRetain, applyInsert } from "./apply-math.js";

/** Wire format: optional attribute object before each retain/insert; deletes are negative. */
export type TextOperationJSON = Array<number | string | Attributes>;

export class TextOperation {
  ops: TextOp[];
  baseLength: number;
  targetLength: number;

  constructor() {
    this.ops = [];
    this.baseLength = 0;
    this.targetLength = 0;
  }

  equals(other: TextOperation): boolean {
    if (this.baseLength !== other.baseLength) return false;
    if (this.targetLength !== other.targetLength) return false;
    if (this.ops.length !== other.ops.length) return false;
    return this.ops.every((op, index) => op.equals(other.ops[index]));
  }

  retain(n: number, attributes?: Attributes): this {
    if (typeof n !== "number" || n < 0) {
      throw new Error("retain expects a positive integer.");
    }
    if (n === 0) return this;
    this.baseLength += n;
    this.targetLength += n;
    attributes = attributes || {};
    const prevOp = this.ops.length > 0 ? this.ops[this.ops.length - 1] : null;
    if (prevOp && prevOp.isRetain() && prevOp.attributesEqual(attributes)) {
      prevOp.chars = (prevOp.chars || 0) + n;
    } else {
      this.ops.push(new TextOp("retain", n, attributes));
    }
    return this;
  }

  insert(str: string, attributes?: Attributes): this {
    if (typeof str !== "string") {
      throw new Error("insert expects a string");
    }
    if (str === "") return this;
    attributes = attributes || {};
    this.targetLength += str.length;
    const prevOp = this.ops.length > 0 ? this.ops[this.ops.length - 1] : null;
    const prevPrevOp =
      this.ops.length > 1 ? this.ops[this.ops.length - 2] : null;
    if (prevOp && prevOp.isInsert() && prevOp.attributesEqual(attributes)) {
      prevOp.text = (prevOp.text || "") + str;
    } else if (prevOp && prevOp.isDelete()) {
      if (
        prevPrevOp &&
        prevPrevOp.isInsert() &&
        prevPrevOp.attributesEqual(attributes)
      ) {
        prevPrevOp.text = (prevPrevOp.text || "") + str;
      } else {
        this.ops[this.ops.length - 1] = new TextOp("insert", str, attributes);
        this.ops.push(prevOp);
      }
    } else {
      this.ops.push(new TextOp("insert", str, attributes));
    }
    return this;
  }

  delete(n: number | string): this {
    if (typeof n === "string") {
      n = n.length;
    }
    if (typeof n !== "number" || n < 0) {
      throw new Error("delete expects a positive integer or a string");
    }
    if (n === 0) return this;
    this.baseLength += n;
    const prevOp = this.ops.length > 0 ? this.ops[this.ops.length - 1] : null;
    if (prevOp && prevOp.isDelete()) {
      prevOp.chars = (prevOp.chars || 0) + n;
    } else {
      this.ops.push(new TextOp("delete", n));
    }
    return this;
  }

  isNoop(): boolean {
    return (
      this.ops.length === 0 ||
      (this.ops.length === 1 &&
        this.ops[0].isRetain() &&
        this.ops[0].hasEmptyAttributes())
    );
  }

  clone(): TextOperation {
    const clone = new TextOperation();
    for (let i = 0; i < this.ops.length; i++) {
      const op = this.ops[i];
      if (op.isRetain()) {
        clone.retain(op.chars || 0, op.attributes || {});
      } else if (op.isInsert()) {
        clone.insert(op.text || "", op.attributes || {});
      } else {
        clone.delete(op.chars || 0);
      }
    }
    return clone;
  }

  toString(): string {
    return this.ops
      .map((op) => {
        if (op.isRetain()) {
          return "retain " + op.chars;
        } else if (op.isInsert()) {
          return "insert '" + op.text + "'";
        } else {
          return "delete " + op.chars;
        }
      })
      .join(", ");
  }

  toJSON(): TextOperationJSON {
    const ops: TextOperationJSON = [];
    for (let i = 0; i < this.ops.length; i++) {
      const op = this.ops[i];
      if (op.attributes !== null && !op.hasEmptyAttributes()) {
        ops.push(op.attributes);
      }
      if (op.isRetain()) {
        ops.push(op.chars);
      } else if (op.isInsert()) {
        ops.push(op.text);
      } else if (op.isDelete()) {
        ops.push(-(op.chars || 0));
      }
    }
    if (ops.length === 0) {
      ops.push(0);
    }
    return ops;
  }

  static fromJSON(ops: unknown): TextOperation {
    if (!Array.isArray(ops)) {
      throw new Error("fromJSON expects an array of ops");
    }
    const o = new TextOperation();
    for (let i = 0, l = ops.length; i < l; i++) {
      let op: unknown = ops[i];
      let attributes: Attributes = {};
      if (typeof op === "object") {
        // Wire boundary: attribute values are stored as sent, not validated.
        attributes = (op ?? {}) as Attributes;
        i++;
        op = ops[i];
      }
      if (typeof op === "number") {
        if (op > 0) {
          o.retain(op, attributes);
        } else {
          o.delete(-op);
        }
      } else {
        if (typeof op !== "string") {
          throw new Error("fromJSON op must be string or number");
        }
        o.insert(op, attributes);
      }
    }
    return o;
  }

  apply(
    str: string,
    oldAttributes?: Attributes[],
    newAttributes?: Attributes[],
  ): string {
    const operation = this;
    oldAttributes = oldAttributes || [];
    newAttributes = newAttributes || [];
    if (str.length !== operation.baseLength) {
      throw new Error(
        "The operation's base length must be equal to the string's length.",
      );
    }
    const newStringParts: string[] = [];
    let j = 0;
    let oldIndex = 0;
    const ops = this.ops;
    for (let i = 0, l = ops.length; i < l; i++) {
      const op = ops[i];
      if (op.isRetain()) {
        const chars = op.chars || 0;
        newStringParts[j++] = applyRetain(op, chars, {
          str,
          oldIndex,
          oldAttributes,
          newAttributes,
        });
        oldIndex += chars;
      } else if (op.isInsert()) {
        const text = op.text || "";
        newStringParts[j++] = applyInsert(op, text, newAttributes);
      } else {
        oldIndex += op.chars || 0;
      }
    }
    if (oldIndex !== str.length) {
      throw new Error("The operation didn't operate on the whole string.");
    }
    return newStringParts.join("");
  }

  invert(str: string): TextOperation {
    let strIndex = 0;
    const inverse = new TextOperation();
    const ops = this.ops;
    for (let i = 0, l = ops.length; i < l; i++) {
      const op = ops[i];
      if (op.isRetain()) {
        const chars = op.chars || 0;
        inverse.retain(chars);
        strIndex += chars;
      } else if (op.isInsert()) {
        inverse.delete((op.text || "").length);
      } else {
        const chars = op.chars || 0;
        inverse.insert(str.slice(strIndex, strIndex + chars));
        strIndex += chars;
      }
    }
    return inverse;
  }

  compose(other: TextOperation): TextOperation {
    return composeOperations(this, other);
  }

  shouldBeComposedWith(other: TextOperation): boolean {
    return shouldBeComposedWith(this, other);
  }

  shouldBeComposedWithInverted(other: TextOperation): boolean {
    return shouldBeComposedWithInverted(this, other);
  }

  static transformAttributes(
    attrs1: Attributes,
    attrs2: Attributes,
  ): [Attributes, Attributes] {
    return transformAttributes(attrs1, attrs2);
  }

  static transform(
    operation1: TextOperation,
    operation2: TextOperation,
  ): [TextOperation, TextOperation] {
    return transformOperations(operation1, operation2);
  }

  transform(other: TextOperation): [TextOperation, TextOperation] {
    return transformOperations(this, other);
  }
}
