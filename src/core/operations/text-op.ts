/**
 * Atomic operation primitive (retain, insert, or delete).
 */
export class TextOp {
  type: "retain" | "insert" | "delete";
  chars: number | null = null;
  text: string | null = null;
  attributes: Record<string, any> | null = null;

  constructor(type: "retain" | "insert" | "delete", ...args: any[]) {
    this.type = type;
    this.initializePayload(args);
  }

  private initializePayload(args: any[]): void {
    const [payload, attributes = {}] = args;

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

  isInsert(): boolean {
    return this.type === "insert";
  }

  isDelete(): boolean {
    return this.type === "delete";
  }

  isRetain(): boolean {
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

  attributesEqual(otherAttributes: Record<string, any>): boolean {
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
