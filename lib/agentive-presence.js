var firepad = firepad || { };

firepad.AgentivePresence = (function() {
  'use strict';

  var TextOperation = firepad.TextOperation || function() {};

  function GhostDiff(agentId, baseRevision, operation, explanation) {
    this.agentId = agentId;
    this.baseRevision = baseRevision;
    this.operation = operation instanceof firepad.TextOperation ? operation : firepad.TextOperation.fromJSON(operation);
    this.explanation = explanation || '';
    this.status = 'suggesting';
  }

  GhostDiff.prototype.rebase = function(humanOperation, newRevision) {
    try {
      var pair = firepad.TextOperation.transform(this.operation, humanOperation);
      this.operation = pair[0];
      this.baseRevision = newRevision;
      return true;
    } catch (e) {
      console.warn('GhostDiff rebase conflict, invalidating suggestion:', e.message);
      this.status = 'invalidated';
      return false;
    }
  };

  GhostDiff.prototype.toJSON = function() {
    return {
      agentId: this.agentId,
      baseRevision: this.baseRevision,
      operation: typeof this.operation.toJSON === 'function' ? this.operation.toJSON() : this.operation,
      explanation: this.explanation,
      status: this.status
    };
  };

  function AgentivePresenceManager(syncSeam) {
    this.syncSeam_ = syncSeam;
    this.activeGhosts_ = {};
    this.unsubscribes_ = [];
    this._listeners = {};
    var self = this;

    if (this.syncSeam_ && this.syncSeam_.operations && this.syncSeam_.operations.subscribe) {
      var unsubOps = this.syncSeam_.operations.subscribe(function(evt) {
        self.handleAuthoritativeOperation_(evt.operation, evt.revision);
      });
      this.unsubscribes_.push(unsubOps);
    }
    if (this.syncSeam_ && this.syncSeam_.agentive && this.syncSeam_.agentive.subscribe) {
      var unsubAgent = this.syncSeam_.agentive.subscribe(function(evt) {
        self.handleAgentiveEvent_(evt);
      });
      this.unsubscribes_.push(unsubAgent);
    }
  }

  AgentivePresenceManager.prototype.on = function(event, fn) {
    this._listeners[event] = this._listeners[event] || [];
    this._listeners[event].push(fn);
  };
  AgentivePresenceManager.prototype.trigger = function(event) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (this._listeners && this._listeners[event]) {
      this._listeners[event].forEach(function(fn) { fn.apply(null, args); });
    }
  };

  AgentivePresenceManager.prototype.handleAuthoritativeOperation_ = function(operation, newRevision) {
    var agentIds = Object.keys(this.activeGhosts_);
    for (var i = 0; i < agentIds.length; i++) {
      var id = agentIds[i];
      var ghost = this.activeGhosts_[id];
      if (ghost && ghost.status === 'suggesting') {
        var ok = ghost.rebase(operation, newRevision);
        if (ok && typeof ghost.operation.isNoop === 'function' && !ghost.operation.isNoop()) {
          this.trigger('ghostRebased', ghost);
        } else if (ok && typeof ghost.operation.isNoop !== 'function') {
          this.trigger('ghostRebased', ghost);
        } else {
          delete this.activeGhosts_[id];
          this.trigger('ghostRemoved', id);
        }
      }
    }
  };

  AgentivePresenceManager.prototype.handleAgentiveEvent_ = function(evt) {
    if (!evt) return;
    var agentId = evt.agentId;
    if (evt.status === 'suggesting' && evt.ghostDiff) {
      var diffData = evt.ghostDiff;
      try {
        var ghost = new GhostDiff(agentId, diffData.baseRevision || 0, diffData.operation || diffData, evt.explanation);
        this.activeGhosts_[agentId] = ghost;
        this.trigger('ghostAdded', ghost);
      } catch(e) {
        console.error('Failed to instantiate GhostDiff from stream:', e);
      }
    } else if (evt.status === 'idle' || evt.status === 'dismissed') {
      if (this.activeGhosts_[agentId]) {
        delete this.activeGhosts_[agentId];
        this.trigger('ghostRemoved', agentId);
      }
    }
  };

  AgentivePresenceManager.prototype.proposeGhostDiff = function(agentId, baseRevision, operation, explanation) {
    var ghost = new GhostDiff(agentId, baseRevision, operation, explanation);
    this.activeGhosts_[agentId] = ghost;
    if (this.syncSeam_ && typeof this.syncSeam_.broadcastAgentive === 'function') {
      this.syncSeam_.broadcastAgentive(agentId, 'suggesting', ghost.toJSON(), explanation);
    }
    this.trigger('ghostAdded', ghost);
    return ghost;
  };

  AgentivePresenceManager.prototype.dismissGhostDiff = function(agentId) {
    delete this.activeGhosts_[agentId];
    if (this.syncSeam_ && typeof this.syncSeam_.broadcastAgentive === 'function') {
      this.syncSeam_.broadcastAgentive(agentId, 'idle', null, '');
    }
    this.trigger('ghostRemoved', agentId);
  };

  AgentivePresenceManager.prototype.acceptGhostDiff = function(agentId) {
    var ghost = this.activeGhosts_[agentId];
    if (!ghost || ghost.status !== 'suggesting') {
      return Promise.reject(new Error('No active valid ghost diff for agent: ' + agentId));
    }
    var self = this;
    var opToCommit = ghost.operation;
    delete this.activeGhosts_[agentId];
    this.trigger('ghostRemoved', agentId);
    if (this.syncSeam_ && typeof this.syncSeam_.commitOperation === 'function') {
      return this.syncSeam_.commitOperation(opToCommit, agentId).then(function(ack) {
        if (typeof self.syncSeam_.broadcastAgentive === 'function') {
          self.syncSeam_.broadcastAgentive(agentId, 'idle', null, 'Suggestion accepted');
        }
        return ack;
      });
    }
    return Promise.resolve({ committed: true, revision: ghost.baseRevision + 1 });
  };

  AgentivePresenceManager.prototype.getActiveGhost = function(agentId) {
    return this.activeGhosts_[agentId] || null;
  };

  AgentivePresenceManager.prototype.getAllGhosts = function() {
    var list = [];
    var keys = Object.keys(this.activeGhosts_);
    for (var i = 0; i < keys.length; i++) {
      list.push(this.activeGhosts_[keys[i]]);
    }
    return list;
  };

  AgentivePresenceManager.prototype.dispose = function() {
    for (var i = 0; i < this.unsubscribes_.length; i++) {
      if (typeof this.unsubscribes_[i] === 'function') this.unsubscribes_[i]();
    }
    this.unsubscribes_ = [];
    this.activeGhosts_ = {};
  };

  return {
    GhostDiff: GhostDiff,
    Manager: AgentivePresenceManager,
    createManager: function(syncSeam) { return new AgentivePresenceManager(syncSeam); }
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = firepad.AgentivePresence;
}
