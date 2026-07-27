describe('SyncSeam & PyricSandboxAdapter', function() {
  var PyricSandbox = firepad.PyricSandbox;
  var SyncSeam = firepad.SyncSeam;
  var TextOperation = firepad.TextOperation;
  var Cursor = firepad.Cursor;

  it('Initializes with reactive streams for operations, presence, and agentive', function(done) {
    var db = PyricSandbox.createDatabase();
    var ref = db.ref('/test-seam');
    var adapter = new SyncSeam.PyricSandboxAdapter(ref, 'user-A', '#00ff00');

    expect(adapter.operations).toBeDefined();
    expect(adapter.presence).toBeDefined();
    expect(adapter.agentive).toBeDefined();
    expect(typeof adapter.operations.subscribe).toBe('function');
    expect(typeof adapter.commitOperation).toBe('function');
    expect(typeof adapter.broadcastPresence).toBe('function');
    expect(typeof adapter.broadcastAgentive).toBe('function');

    adapter.on('ready', function() {
      adapter.dispose();
      done();
    });
  });

  it('Handles commitOperation and streams operation events', async function() {
    var db = PyricSandbox.createDatabase();
    var ref = db.ref('/test-ops');
    var adapterA = new SyncSeam.PyricSandboxAdapter(ref, 'user-A', '#ff0000');
    var adapterB = new SyncSeam.PyricSandboxAdapter(ref, 'user-B', '#0000ff');

    await new Promise(r => setTimeout(r, 20));

    var receivedB = null;
    var unsub = adapterB.operations.subscribe(function(evt) {
      receivedB = evt;
    });

    var op = new TextOperation().insert('Hello Seam!');
    var ack = await adapterA.commitOperation(op);
    expect(ack.committed).toBe(true);
    expect(ack.revision).toBe(1);

    await new Promise(r => setTimeout(r, 20));
    expect(receivedB).not.toBeNull();
    expect(receivedB.author).toBe('user-A');
    expect(receivedB.operation.ops[0].text).toBe('Hello Seam!');

    unsub();
    adapterA.dispose();
    adapterB.dispose();
  });

  it('Handles broadcastPresence and streams cursor updates', async function() {
    var db = PyricSandbox.createDatabase();
    var ref = db.ref('/test-cursor');
    var adapterA = new SyncSeam.PyricSandboxAdapter(ref, 'user-A', '#ff0000');
    var adapterB = new SyncSeam.PyricSandboxAdapter(ref, 'user-B', '#0000ff');

    await new Promise(r => setTimeout(r, 20));

    var cursorB = null;
    adapterB.presence.subscribe(function(evt) {
      if (evt.userId === 'user-A') {
        cursorB = evt;
      }
    });

    var cur = new Cursor(0, 5);
    await adapterA.broadcastPresence(cur);

    await new Promise(r => setTimeout(r, 30));
    expect(cursorB).not.toBeNull();
    expect(cursorB.userId).toBe('user-A');
    expect(cursorB.color).toBe('#ff0000');
    expect(cursorB.cursor.position).toBe(0);

    adapterA.dispose();
    adapterB.dispose();
  });

  it('Handles broadcastAgentive and streams AI co-pilot status & tentative ghost diffs', async function() {
    var db = PyricSandbox.createDatabase();
    var ref = db.ref('/test-agentive');
    var adapterA = new SyncSeam.PyricSandboxAdapter(ref, 'user-A', '#ff0000');
    var adapterB = new SyncSeam.PyricSandboxAdapter(ref, 'user-B', '#0000ff');

    await new Promise(r => setTimeout(r, 20));

    var agentEvent = null;
    adapterB.agentive.subscribe(function(evt) {
      agentEvent = evt;
    });

    await adapterA.broadcastAgentive('agent-777', 'thinking', null, 'Analyzing code structure');

    await new Promise(r => setTimeout(r, 30));
    expect(agentEvent).not.toBeNull();
    expect(agentEvent.agentId).toBe('agent-777');
    expect(agentEvent.status).toBe('thinking');
    expect(agentEvent.explanation).toBe('Analyzing code structure');

    adapterA.dispose();
    adapterB.dispose();
  });
});
