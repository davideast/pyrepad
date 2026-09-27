/**
 * A WrappedOperation contains an operation and corresponding metadata.
 */
import type { TextOperation } from "./text-operation.js";

/** Metadata is opaque; it may implement compose/transform/invert hooks. */
function hasMethod<K extends string>(
  value: unknown,
  name: K,
): value is Record<K, (...args: unknown[]) => unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Record<K, unknown>)[name] === "function"
  );
}

function composeMeta(a: unknown, b: unknown): unknown {
  if (a && typeof a === "object") {
    if (hasMethod(a, "compose")) {
      return a.compose(b);
    }
    // Spread tolerates any value for `b`, exactly as the untyped original did.
    return { ...a, ...(b as object) };
  }
  return b;
}

function transformMeta(meta: unknown, operation: TextOperation): unknown {
  if (hasMethod(meta, "transform")) {
    return meta.transform(operation);
  }
  return meta;
}

export class WrappedOperation {
  wrapped: TextOperation;
  meta: unknown;

  constructor(operation: TextOperation, meta: unknown) {
    this.wrapped = operation;
    this.meta = meta;
  }

  apply(...args: Parameters<TextOperation["apply"]>): string {
    return this.wrapped.apply(...args);
  }

  invert(...args: Parameters<TextOperation["invert"]>): WrappedOperation {
    let nextMeta = this.meta;
    if (hasMethod(nextMeta, "invert")) {
      nextMeta = nextMeta.invert(...args);
    }
    return new WrappedOperation(this.wrapped.invert(...args), nextMeta);
  }

  compose(other: WrappedOperation): WrappedOperation {
    return new WrappedOperation(
      this.wrapped.compose(other.wrapped),
      composeMeta(this.meta, other.meta),
    );
  }

  static transform(
    a: WrappedOperation,
    b: WrappedOperation,
  ): [WrappedOperation, WrappedOperation] {
    const pair = a.wrapped.transform(b.wrapped);
    return [
      new WrappedOperation(pair[0], transformMeta(a.meta, b.wrapped)),
      new WrappedOperation(pair[1], transformMeta(b.meta, a.wrapped)),
    ];
  }

  transform(other: WrappedOperation): [WrappedOperation, WrappedOperation] {
    return WrappedOperation.transform(this, other);
  }
}
