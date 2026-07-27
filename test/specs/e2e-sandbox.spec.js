describe('E2E Collaboration in Pyric Sandbox (PR 2.3)', function() {
  var PyricSandbox = firepad.PyricSandbox;
  var SyncSeam = firepad.SyncSeam;
  var Firepad = firepad.Firepad;
  var TextOperation = firepad.TextOperation;

  var _hiddenDiv;
  function hiddenDiv() {
    if (!_hiddenDiv) {
      _hiddenDiv = document.createElement('div');
      _hiddenDiv.style.display = 'none';
      document.body.appendChild(_hiddenDiv);
    }
    return _hiddenDiv;
  }

  it('Syncs edits between two independent EditorClients over PyricSandboxAdapter', async function() {
    var db = PyricSandbox.createDatabase();
    var ref = db.ref('/collaborate-pad');

    var cmA = CodeMirror(hiddenDiv());
    var cmB = CodeMirror(hiddenDiv());

    var adapterA = new SyncSeam.PyricSandboxAdapter(ref, 'client-Alice', '#ff0000');
    var adapterB = new SyncSeam.PyricSandboxAdapter(ref, 'client-Bob', '#0000ff');

    var padA = new Firepad(ref, cmA, { syncAdapter: adapterA, userId: 'client-Alice' });
    var padB = new Firepad(ref, cmB, { syncAdapter: adapterB, userId: 'client-Bob' });

    await new Promise(r => setTimeout(r, 50));

    padA.setText('Hello from Alice via SyncSeam!');

    await new Promise(r => setTimeout(r, 80));

    expect(cmA.getValue()).toBe('Hello from Alice via SyncSeam!');
    expect(cmB.getValue()).toBe('Hello from Alice via SyncSeam!');

    padA.dispose();
    padB.dispose();
  });
});
