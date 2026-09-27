/**
 * Atomic operation primitive (retain, insert, or delete).
 */
export type TextOpType = "retain" | "insert" | "delete";

/** A formatting attribute value; `false` on a retain removes the attribute. */
export type AttributeValue = string | number | boolean;
export type Attributes = Record<string, AttributeValue>;

export type RetainOp = TextOp & {
  type: "retain";
  chars: number;
  attributes: Attributes;
};
export type InsertOp = TextOp & {
  type: "insert";
  text: string;
  attributes: Attributes;
};
export type DeleteOp = TextOp & { type: "delete"; chars: number };

export class TextOp {
  type: TextOpType;
  chars: number | null = null;
  text: string | null = null;
  attributes: Attributes | null = null;

  constructor(
    type: TextOpType,
    payload?: string | number,
    attributes?: Attributes,
  ) {
    this.type = type;
    this.initializePayload(payload, attributes);
  }

  private initializePayload(
    payload: string | number | undefined,
    attributes: Attributes = {},
  ): void {
    const isTextValid = typeof payload === "string";
    const isCharsValid = typeof payload === "number";
    const areAttributesValid =
      typeof attributes === "object" && attributes !== null;

    switch (this.type) {
      case "insert": {
        if (!isTextValid) {
          throw new Error("insert op requires text string");
        }
        if (!areAttributesValid) {
          throw new Error("attributes must be an object");
        }
        this.text = payload;
        this.attributes = attributes;
        break;
      }
      case "delete": {
        if (!isCharsValid) {
          throw new Error("delete op requires chars number");
        }
        this.chars = payload;
        break;
      }
      case "retain": {
        if (!isCharsValid) {
          throw new Error("retain op requires chars number");
        }
        if (!areAttributesValid) {
          throw new Error("attributes must be an object");
        }
        this.chars = payload;
        this.attributes = attributes;
        break;
      }
    }
  }

  isInsert(): this is InsertOp {
    return this.type === "insert";
  }

  isDelete(): this is DeleteOp {
    return this.type === "delete";
  }

  isRetain(): this is RetainOp {
    return this.type === "retain";
  }

  equals(other: TextOp): boolean {
    return (
      this.type === other.type &&
      this.text === other.text &&
      this.chars === other.chars &&
      this.attributesEqual(other.attributes || {})
    );
  }

  attributesEqual(otherAttributes: Attributes): boolean {
    const attrs = this.attributes || {};
    for (const attr in attrs) {
      if (attrs[attr] !== otherAttributes[attr]) {
        return false;
      }
    }
    for (const attr in otherAttributes) {
      if (attrs[attr] !== otherAttributes[attr]) {
        return false;
      }
    }
    return true;
  }

  hasEmptyAttributes(): boolean {
    const attrs = this.attributes || {};
    for (const _attr in attrs) {
      return false;
    }
    return true;
  }
}
