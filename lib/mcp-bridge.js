var firepad = firepad || { };

firepad.PyricMCPBridge = (function() {
  'use strict';

  var AgentivePresence = firepad.AgentivePresence;
  var TextOperation = firepad.TextOperation;

  function MCPBridge(documentEngine, syncSeam, agentId) {
    this.engine_ = documentEngine;
    this.syncSeam_ = syncSeam;
    this.agentId_ = agentId || 'pyric-mcp-agent';
    this.presenceManager_ = (AgentivePresence && AgentivePresence.createManager) ? AgentivePresence.createManager(syncSeam) : null;
    this.history_ = [];
    this.collaborators_ = {};

    var self = this;
    if (this.syncSeam_ && this.syncSeam_.operations && this.syncSeam_.operations.subscribe) {
      this.syncSeam_.operations.subscribe(function(evt) {
        self.history_.push(evt);
      });
    }
    if (this.syncSeam_ && this.syncSeam_.presence && this.syncSeam_.presence.subscribe) {
      this.syncSeam_.presence.subscribe(function(evt) {
        if (evt.state === 'active') {
          self.collaborators_[evt.userId] = evt;
        } else {
          delete self.collaborators_[evt.userId];
        }
      });
    }
  }

  MCPBridge.prototype.inspectState = function() {
    var text = this.engine_ ? (typeof this.engine_.getValue === 'function' ? this.engine_.getValue() : '') : '';
    var cur = this.engine_ ? (typeof this.engine_.getCursor === 'function' ? this.engine_.getCursor() : null) : null;
    var lastRev = this.history_.length > 0 ? this.history_[this.history_.length - 1].revision : 0;
    return {
      agentId: this.agentId_,
      currentText: text,
      currentRevision: lastRev,
      activeCollaborators: Object.keys(this.collaborators_),
      cursor: cur ? (typeof cur.toJSON === 'function' ? cur.toJSON() : cur) : null,
      activeGhost: this.presenceManager_ ? this.presenceManager_.getActiveGhost(this.agentId_) : null
    };
  };

  MCPBridge.prototype.streamThinking = function(explanation) {
    if (this.syncSeam_ && typeof this.syncSeam_.broadcastAgentive === 'function') {
      return this.syncSeam_.broadcastAgentive(this.agentId_, 'thinking', null, explanation || 'Analyzing document...');
    }
    return Promise.resolve();
  };

  MCPBridge.prototype.proposeRefactor = function(operation, explanation) {
    var state = this.inspectState();
    if (this.presenceManager_) {
      var ghost = this.presenceManager_.proposeGhostDiff(this.agentId_, state.currentRevision, operation, explanation || 'Suggested AI refactoring diff');
      return Promise.resolve(ghost.toJSON());
    }
    return Promise.reject(new Error('AgentivePresenceManager not configured'));
  };

  MCPBridge.prototype.promoteDiff = function() {
    if (this.presenceManager_) {
      return this.presenceManager_.acceptGhostDiff(this.agentId_);
    }
    return Promise.reject(new Error('AgentivePresenceManager not configured'));
  };

  MCPBridge.prototype.dismissDiff = function() {
    if (this.presenceManager_) {
      this.presenceManager_.dismissGhostDiff(this.agentId_);
    }
    return Promise.resolve();
  };

  MCPBridge.prototype.handleCommand = function(cmdObject) {
    if (!cmdObject || !cmdObject.method) {
      return Promise.reject(new Error('Invalid MCP command object: method missing'));
    }
    switch (cmdObject.method) {
      case 'inspect_doc':
        return Promise.resolve(this.inspectState());
      case 'stream_thinking':
        return this.streamThinking(cmdObject.params ? cmdObject.params.explanation : '');
      case 'propose_diff':
        if (!cmdObject.params || !cmdObject.params.operation) {
          return Promise.reject(new Error('propose_diff requires operation parameter'));
        }
        return this.proposeRefactor(cmdObject.params.operation, cmdObject.params.explanation);
      case 'promote_diff':
        return this.promoteDiff();
      case 'dismiss_diff':
        return this.dismissDiff();
      default:
        return Promise.reject(new Error('Unknown MCP method: ' + cmdObject.method));
    }
  };

  MCPBridge.prototype.dispose = function() {
    if (this.presenceManager_) {
      this.presenceManager_.dispose();
    }
  };

  return {
    Bridge: MCPBridge,
    createBridge: function(engine, syncSeam, agentId) {
      return new MCPBridge(engine, syncSeam, agentId);
    }
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = firepad.PyricMCPBridge;
}
