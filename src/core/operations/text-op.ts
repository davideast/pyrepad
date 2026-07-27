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

    if (type === "insert") {
      this.text = args[0];
      if (typeof this.text !== "string") {
        throw new Error("insert op requires text string");
      }
      this.attributes = args[1] || {};
      if (typeof this.attributes !== "object") {
        throw new Error("attributes must be an object");
      }
    } else if (type === "delete") {
      this.chars = args[0];
      if (typeof this.chars !== "number") {
        throw new Error("delete op requires chars number");
      }
    } else if (type === "retain") {
      this.chars = args[0];
      if (typeof this.chars !== "number") {
        throw new Error("retain op requires chars number");
      }
      this.attributes = args[1] || {};
      if (typeof this.attributes !== "object") {
        throw new Error("attributes must be an object");
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
