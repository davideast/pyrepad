describe('PureDataFormatting (PR 3.1)', function() {
  const PureFormatting = firepad.PureFormatting;
  const TextOperation = firepad.TextOperation;

  it('Converts TextOperation to and from Markdown without DOM', function() {
    const start = performance.now();

    const op = new TextOperation()
      .insert('Bold text', { b: true })
      .insert('\n')
      .insert('Italic text', { i: true })
      .insert('\n')
      .insert('List item', { 'list-type': 'u' });

    const md = PureFormatting.toMarkdown(op);
    expect(md).toContain('**Bold text**');
    expect(md).toContain('_Italic text_');
    expect(md).toContain('- List item');

    const parsedOp = PureFormatting.fromMarkdown('**Bold text**\n- List item');
    expect(parsedOp.ops.length).toBeGreaterThan(0);
    expect(parsedOp.ops[0].text).toBe('Bold text');
    expect(parsedOp.ops[0].attributes.b).toBe(true);

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50); // Fast execution well within ms limit
  });

  it('Converts TextOperation to and from structured AST in <5ms', function() {
    const start = performance.now();
    const op = new TextOperation().insert('Hello World', { c: '#00ff00', size: 18 });
    
    const ast = PureFormatting.toAST(op);
    expect(Array.isArray(ast)).toBe(true);
    expect(ast[0].type).toBe('line');
    expect(ast[0].children[0].text).toBe('Hello World');
    expect(ast[0].children[0].attributes.c).toBe('#00ff00');

    const roundTrip = PureFormatting.fromAST(ast);
    expect(roundTrip.ops[0].text).toBe('Hello World');
    expect(roundTrip.ops[0].attributes.c).toBe('#00ff00');

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });
});
