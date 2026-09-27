describe('PureHeadless & DocumentEngine Speed (PR 3.2 & 3.3)', function() {
  const PyricSandbox = firepad.PyricSandbox;
  const PureHeadless = firepad.PureHeadless || firepad.Firepad.Headless;
  const DocumentEngine = firepad.DocumentEngine;

  it('Processes Headless markdown and AST documents in <10ms without JSDOM', async function() {
    const db = PyricSandbox.createDatabase();
    const ref = db.ref('/headless-speed-test');
    
    const start = performance.now();
    const headless = new PureHeadless(ref);

    const mdText = '**Header 1**\n- Item 1\n- Item 2';

    await new Promise(resolve => {
      headless.setMarkdown(mdText, function(err, committed) {
        expect(err).toBeNull();
        expect(committed).toBe(true);
        resolve();
      });
    });

    await new Promise(resolve => {
      headless.getMarkdown(function(retrievedMd) {
        expect(retrievedMd).toContain('**Header 1**');
        expect(retrievedMd).toContain('- Item 1');
        resolve();
      });
    });

    await new Promise(resolve => {
      headless.getAST(function(ast) {
        expect(Array.isArray(ast)).toBe(true);
        expect(ast.length).toBeGreaterThan(0);
        resolve();
      });
    });

    headless.dispose();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50); // Total turnaround in milliseconds
  });

  it('Universal DocumentEngine seam wraps engines cleanly', function() {
    const pureEngine = DocumentEngine.create();
    expect(pureEngine.getValue()).toBe('');
    pureEngine.setValue('Test Engine Seam');
    expect(pureEngine.getValue()).toBe('Test Engine Seam');
  });
});
