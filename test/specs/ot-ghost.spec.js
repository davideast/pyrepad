describe('OT Ghost Diff Rebasing & Invariant Fuzzing (PR 4.1)', function() {
  var PyricSandbox = firepad.PyricSandbox;
  var SyncSeam = firepad.SyncSeam;
  var AgentivePresence = firepad.AgentivePresence;
  var TextOperation = firepad.TextOperation;

  it('Rebases AI ghost diffs against concurrent human operations without corrupting state', async function() {
    var db = PyricSandbox.createDatabase();
    var ref = db.ref('/ghost-test');

    var adapter = new SyncSeam.PyricSandboxAdapter(ref, 'human-1', '#00ff00');
    var manager = AgentivePresence.createManager(adapter);

    // AI proposes inserting a refactored comment at position 5
    var initialOp = new TextOperation().retain(5).insert('// AI Refactor\n');
    var ghost = manager.proposeGhostDiff('copilot-x', 1, initialOp, 'Add method header comment');

    expect(ghost.status).toBe('suggesting');
    expect(manager.getActiveGhost('copilot-x')).toBe(ghost);

    // Concurrently, human inserts 3 characters at the very start of the file (position 0)
    var humanOp = new TextOperation().insert('var ').retain(5);
    
    // Simulate authoritative human operation arriving
    manager.handleAuthoritativeOperation_(humanOp, 2);

    var rebasedGhost = manager.getActiveGhost('copilot-x');
    expect(rebasedGhost).not.toBeNull();
    expect(rebasedGhost.baseRevision).toBe(2);
    // The retain should have been shifted by 4 characters (len('var ') === 4) from 5 to 9!
    expect(rebasedGhost.operation.ops[0].chars).toBe(9);
    expect(rebasedGhost.operation.ops[1].text).toBe('// AI Refactor\n');

    manager.dispose();
    adapter.dispose();
  });

  it('Fuzz testing: random human edits never invalidate authoritative document constraints', function() {
    var docString = 'abcdefghijklmnopqrstuvwxyz';
    var aiOp = new TextOperation().retain(10).insert('[GHOST SUGGESTION]').retain(16);
    
    var ghost = new AgentivePresence.GhostDiff('ai-agent', 0, aiOp, 'Fuzz test ghost');
    var currentDoc = docString;

    // Execute 20 iterations of random human insertions before the ghost suggestion
    for (var i = 0; i < 20; i++) {
      var insertLen = 1 + Math.floor(Math.random() * 5);
      var prefix = 'X'.repeat(insertLen);
      var humanOp = new TextOperation().insert(prefix).retain(currentDoc.length);
      
      currentDoc = prefix + currentDoc;
      var success = ghost.rebase(humanOp, i + 1);
      expect(success).toBe(true);
    }

    // Applying the rebased ghost operation to currentDoc must be mathematically valid and not throw!
    var finalWithGhost = ghost.operation.apply(currentDoc);
    expect(finalWithGhost).toContain('[GHOST SUGGESTION]');
    expect(finalWithGhost.length).toBe(docString.length + (currentDoc.length - docString.length) + 18);
  });
});
