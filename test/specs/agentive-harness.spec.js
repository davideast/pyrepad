describe('Pyric MCP Collaboration Bridge & Agentive Harness (PR 4.2)', function() {
  var PyricSandbox = firepad.PyricSandbox;
  var SyncSeam = firepad.SyncSeam;
  var DocumentEngine = firepad.DocumentEngine;
  var PyricMCPBridge = firepad.PyricMCPBridge;
  var TextOperation = firepad.TextOperation;
  var Cursor = firepad.Cursor;

  it('Verifies an AI co-pilot streaming refactoring diffs via MCP commands concurrently with human typing', async function() {
    var db = PyricSandbox.createDatabase();
    var ref = db.ref('/mcp-agentive-harness');

    // 1. Setup Human Client & Sync Seam Adapter
    var humanAdapter = new SyncSeam.PyricSandboxAdapter(ref, 'dev-david', '#00ff00');
    var humanEngine = DocumentEngine.create();
    humanEngine.setValue('function add(a, b) { return a + b; }');

    // 2. Setup AI Co-Pilot via Pyric MCP Bridge
    var aiAdapter = new SyncSeam.PyricSandboxAdapter(ref, 'ai-gemini', '#8a2be2');
    var bridge = PyricMCPBridge.createBridge(humanEngine, aiAdapter, 'ai-gemini');

    await new Promise(r => setTimeout(r, 40));

    // Simulate human broadcasting cursor presence
    await humanAdapter.broadcastPresence(new Cursor(0, 15));
    await new Promise(r => setTimeout(r, 30));

    // 3. AI executes MCP command: 'inspect_doc'
    var state = await bridge.handleCommand({ method: 'inspect_doc' });
    expect(state.agentId).toBe('ai-gemini');
    expect(state.currentText).toBe('function add(a, b) { return a + b; }');
    expect(state.activeCollaborators).toContain('dev-david');

    // 4. AI executes MCP command: 'stream_thinking'
    await bridge.handleCommand({ method: 'stream_thinking', params: { explanation: 'Checking type safety...' } });

    // 5. AI executes MCP command: 'propose_diff' (proposing adding TypeScript types or documentation)
    var diffOp = new TextOperation().insert('/** @return {number} */\n').retain(state.currentText.length);
    var proposal = await bridge.handleCommand({
      method: 'propose_diff',
      params: {
        operation: diffOp,
        explanation: 'Add JSDoc return type notation for better IDE autocompletion'
      }
    });

    expect(proposal.status).toBe('suggesting');
    expect(proposal.agentId).toBe('ai-gemini');

    // 6. Inspect state shows active ghost diff
    var updatedState = await bridge.handleCommand({ method: 'inspect_doc' });
    expect(updatedState.activeGhost).not.toBeNull();
    expect(updatedState.activeGhost.explanation).toBe('Add JSDoc return type notation for better IDE autocompletion');

    // 7. Human reviews and accepts ghost diff via MCP command: 'promote_diff'
    var commitAck = await bridge.handleCommand({ method: 'promote_diff' });
    expect(commitAck.committed).toBe(true);
    await new Promise(r => setTimeout(r, 30));

    // Ghost suggestion is now cleared after authoritative commit
    var finalState = await bridge.handleCommand({ method: 'inspect_doc' });
    expect(finalState.activeGhost).toBeNull();

    bridge.dispose();
    humanAdapter.dispose();
    aiAdapter.dispose();
  });
});
