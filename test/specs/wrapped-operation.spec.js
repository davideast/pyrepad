describe('WrappedOperation', function() {
  const WrappedOperation = firepad.WrappedOperation;
  const TextOperation = firepad.TextOperation;
  const Cursor = firepad.Cursor;
  const h = helpers;
  const n = 20;

  it('Apply', helpers.randomTest(n, function() {
    const str = h.randomString(50);
    const operation = h.randomOperation(str);
    const wrapped = new WrappedOperation(operation, { lorem: 42 });
    expect(wrapped.meta.lorem).toBe(42);
    expect(wrapped.apply(str)).toBe(operation.apply(str));
  }));

  it('Invert', helpers.randomTest(n, function() {
    const str = h.randomString(50);
    const operation = h.randomOperation(str);
    const payload = { lorem: 'ipsum' };
    const wrapped = new WrappedOperation(operation, payload);
    const wrappedInverted = wrapped.invert(str);
    expect(wrappedInverted.meta).toBe(payload);
    expect(str).toBe(wrappedInverted.apply(operation.apply(str)));
  }));

  it('InvertMethod', function() {
    const str = h.randomString(50);
    const operation = h.randomOperation(str);
    const meta = { invert: function (doc) { return doc; } };
    const wrapped = new WrappedOperation(operation, meta);
    expect(wrapped.invert(str).meta).toBe(str);
  });

  it('Compose', helpers.randomTest(n, function() {
    const str = h.randomString(50);
    const a = new WrappedOperation(h.randomOperation(str), { a: 1, b: 2 });
    const strN = a.apply(str);
    const b = new WrappedOperation(h.randomOperation(strN), { a: 3, c: 4 });
    const ab = a.compose(b);
    expect(ab.meta.a).toBe(3);
    expect(ab.meta.b).toBe(2);
    expect(ab.meta.c).toBe(4);
    expect(ab.apply(str)).toBe(b.apply(strN));
  }));

  it('ComposeMethod', function() {
    const meta = {
      timesComposed: 0,
      compose: function (other) {
        return {
          timesComposed: this.timesComposed + other.timesComposed + 1,
          compose: meta.compose
        };
      }
    };
    const str = h.randomString(50);
    const a = new WrappedOperation(h.randomOperation(str), meta);
    const strN = a.apply(str);
    const b = new WrappedOperation(h.randomOperation(strN), meta);
    const ab = a.compose(b);
    expect(ab.meta.timesComposed).toBe(1);
  });

  it('Transform', helpers.randomTest(n, function() {
    const str = h.randomString(50);
    const metaA = {};
    const a = new WrappedOperation(h.randomOperation(str), metaA);
    const metaB = {};
    const b = new WrappedOperation(h.randomOperation(str), metaB);
    const pair = a.transform(b);
    const aPrime = pair[0];
    const bPrime = pair[1];
    expect(aPrime.meta).toBe(metaA);
    expect(bPrime.meta).toBe(metaB);
    expect(aPrime.apply(b.apply(str))).toBe(bPrime.apply(a.apply(str)));
  }));

  it('TransformMethod', function() {
    const str = 'Loorem ipsum';
    const a = new WrappedOperation(
      new TextOperation().retain(1)['delete'](1).retain(10),
      new Cursor(1, 1)
    );
    const b = new WrappedOperation(
      new TextOperation().retain(7)['delete'](1).insert("I").retain(4),
      new Cursor(8, 8)
    );
    const pair = a.transform(b);
    const aPrime = pair[0];
    const bPrime = pair[1];
    expect("Lorem Ipsum").toBe(bPrime.apply(a.apply(str)));
    expect(aPrime.meta.equals(new Cursor(1, 1))).toBeTruthy();
    expect(bPrime.meta.equals(new Cursor(7, 7))).toBeTruthy();
  });
});
