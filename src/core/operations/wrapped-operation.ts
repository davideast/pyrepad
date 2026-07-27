/**
 * A WrappedOperation contains an operation and corresponding metadata.
 */
function composeMeta(a: any, b: any): any {
  if (a && typeof a === "object") {
    if (typeof a.compose === "function") {
      return a.compose(b);
    }
    return { ...a, ...b };
  }
  return b;
}

function transformMeta(meta: any, operation: any): any {
  if (meta && typeof meta === "object") {
    if (typeof meta.transform === "function") {
      return meta.transform(operation);
    }
  }
  return meta;
}

export class WrappedOperation {
  wrapped: any;
  meta: any;

  constructor(operation: any, meta: any) {
    this.wrapped = operation;
    this.meta = meta;
  }

  apply(...args: any[]): any {
    return this.wrapped.apply(...args);
  }

  invert(...args: any[]): WrappedOperation {
    let nextMeta = this.meta;
    const isInvertible =
      nextMeta !== null &&
      typeof nextMeta === "object" &&
      typeof nextMeta.invert === "function";
    if (isInvertible) {
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
