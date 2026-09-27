describe('OT Ghost Diff Rebasing & Invariant Fuzzing (PR 4.1)', function() {
  const PyricSandbox = firepad.PyricSandbox;
  const SyncSeam = firepad.SyncSeam;
  const AgentivePresence = firepad.AgentivePresence;
  const TextOperation = firepad.TextOperation;

  it('Rebases AI ghost diffs against concurrent human operations without corrupting state', async function() {
    const db = PyricSandbox.createDatabase();
    const ref = db.ref('/ghost-test');

    const adapter = new SyncSeam.PyricSandboxAdapter(ref, 'human-1', '#00ff00');
    const manager = AgentivePresence.createManager(adapter);

    // AI proposes inserting a refactored comment at position 5
    const initialOp = new TextOperation().retain(5).insert('// AI Refactor\n');
    const ghost = manager.proposeGhostDiff('copilot-x', 1, initialOp, 'Add method header comment');

    expect(ghost.status).toBe('suggesting');
    expect(manager.getActiveGhost('copilot-x')).toBe(ghost);

    // Concurrently, human inserts 3 characters at the very start of the file (position 0)
    const humanOp = new TextOperation().insert('var ').retain(5);
    
    // Simulate authoritative human operation arriving
    manager.handleAuthoritativeOperation_(humanOp, 2);

    const rebasedGhost = manager.getActiveGhost('copilot-x');
    expect(rebasedGhost).not.toBeNull();
    expect(rebasedGhost.baseRevision).toBe(2);
    // The retain should have been shifted by 4 characters (len('var ') === 4) from 5 to 9!
    expect(rebasedGhost.operation.ops[0].chars).toBe(9);
    expect(rebasedGhost.operation.ops[1].text).toBe('// AI Refactor\n');

    manager.dispose();
    adapter.dispose();
  });

  it('Fuzz testing: random human edits never invalidate authoritative document constraints', function() {
    const docString = 'abcdefghijklmnopqrstuvwxyz';
    const aiOp = new TextOperation().retain(10).insert('[GHOST SUGGESTION]').retain(16);
    
    const ghost = new AgentivePresence.GhostDiff('ai-agent', 0, aiOp, 'Fuzz test ghost');
    let currentDoc = docString;

    // Execute 20 iterations of random human insertions before the ghost suggestion
    for (let i = 0; i < 20; i++) {
      const insertLen = 1 + helpers.randomInt(5);
      const prefix = 'X'.repeat(insertLen);
      const humanOp = new TextOperation().insert(prefix).retain(currentDoc.length);
      
      currentDoc = prefix + currentDoc;
      const success = ghost.rebase(humanOp, i + 1);
      expect(success).toBe(true);
    }

    // Applying the rebased ghost operation to currentDoc must be mathematically valid and not throw!
    const finalWithGhost = ghost.operation.apply(currentDoc);
    expect(finalWithGhost).toContain('[GHOST SUGGESTION]');
    expect(finalWithGhost.length).toBe(docString.length + (currentDoc.length - docString.length) + 18);
  });
});
