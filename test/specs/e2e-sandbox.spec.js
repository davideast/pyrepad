describe('E2E Collaboration in Pyric Sandbox (PR 2.3)', function() {
  const PyricSandbox = firepad.PyricSandbox;
  const SyncSeam = firepad.SyncSeam;
  const Firepad = firepad.Firepad;
  const TextOperation = firepad.TextOperation;

  let _hiddenDiv;
  function hiddenDiv() {
    if (!_hiddenDiv) {
      _hiddenDiv = document.createElement('div');
      _hiddenDiv.style.display = 'none';
      document.body.appendChild(_hiddenDiv);
    }
    return _hiddenDiv;
  }

  it('Syncs edits between two independent EditorClients over PyricSandboxAdapter', async function() {
    const db = PyricSandbox.createDatabase();
    const ref = db.ref('/collaborate-pad');

    const cmA = CodeMirror(hiddenDiv());
    const cmB = CodeMirror(hiddenDiv());

    const adapterA = new SyncSeam.PyricSandboxAdapter(ref, 'client-Alice', '#ff0000');
    const adapterB = new SyncSeam.PyricSandboxAdapter(ref, 'client-Bob', '#0000ff');

    const padA = new Firepad(ref, cmA, { syncAdapter: adapterA, userId: 'client-Alice' });
    const padB = new Firepad(ref, cmB, { syncAdapter: adapterB, userId: 'client-Bob' });

    await new Promise(r => setTimeout(r, 50));

    padA.setText('Hello from Alice via SyncSeam!');

    await new Promise(r => setTimeout(r, 80));

    expect(cmA.getValue()).toBe('Hello from Alice via SyncSeam!');
    expect(cmB.getValue()).toBe('Hello from Alice via SyncSeam!');

    padA.dispose();
    padB.dispose();
  });
});
