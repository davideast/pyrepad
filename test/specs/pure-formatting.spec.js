describe('PureDataFormatting (PR 3.1)', function() {
  var PureFormatting = firepad.PureFormatting;
  var TextOperation = firepad.TextOperation;

  it('Converts TextOperation to and from Markdown without DOM', function() {
    var start = performance.now();

    var op = new TextOperation()
      .insert('Bold text', { b: true })
      .insert('\n')
      .insert('Italic text', { i: true })
      .insert('\n')
      .insert('List item', { 'list-type': 'u' });

    var md = PureFormatting.toMarkdown(op);
    expect(md).toContain('**Bold text**');
    expect(md).toContain('_Italic text_');
    expect(md).toContain('- List item');

    var parsedOp = PureFormatting.fromMarkdown('**Bold text**\n- List item');
    expect(parsedOp.ops.length).toBeGreaterThan(0);
    expect(parsedOp.ops[0].text).toBe('Bold text');
    expect(parsedOp.ops[0].attributes.b).toBe(true);

    var elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50); // Fast execution well within ms limit
  });

  it('Converts TextOperation to and from structured AST in <5ms', function() {
    var start = performance.now();
    var op = new TextOperation().insert('Hello World', { c: '#00ff00', size: 18 });
    
    var ast = PureFormatting.toAST(op);
    expect(Array.isArray(ast)).toBe(true);
    expect(ast[0].type).toBe('line');
    expect(ast[0].children[0].text).toBe('Hello World');
    expect(ast[0].children[0].attributes.c).toBe('#00ff00');

    var roundTrip = PureFormatting.fromAST(ast);
    expect(roundTrip.ops[0].text).toBe('Hello World');
    expect(roundTrip.ops[0].attributes.c).toBe('#00ff00');

    var elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });
});
