var firepad = firepad || { };

firepad.SyncSeam = (function() {
  'use strict';

  var utils = firepad.utils || {
    makeEventEmitter: function(clazz, events) {
      clazz.prototype.on = function(event, fn) {
        this._listeners = this._listeners || {};
        this._listeners[event] = this._listeners[event] || [];
        this._listeners[event].push(fn);
      };
      clazz.prototype.trigger = function(event) {
        var args = Array.prototype.slice.call(arguments, 1);
        if (this._listeners && this._listeners[event]) {
          this._listeners[event].forEach(function(fn) { fn.apply(null, args); });
        }
      };
    },
    revisionToId: function(rev) { return 'A' + rev.toString(36); }
  };
  var TextOperation = firepad.TextOperation;
  var Cursor = firepad.Cursor;

  function ReactiveStream() {
    this._listeners = [];
  }
  ReactiveStream.prototype.subscribe = function(fn) {
    this._listeners.push(fn);
    var self = this;
    return function unsubscribe() {
      self._listeners = self._listeners.filter(function(l) { return l !== fn; });
    };
  };
  ReactiveStream.prototype.push = function(evt) {
    this._listeners.forEach(function(fn) {
      try { fn(evt); } catch(e) { console.error('SyncSeam stream subscriber error:', e); }
    });
  };
  ReactiveStream.prototype[Symbol.asyncIterator] = function() {
    var queue = [];
    var resolveNext = null;
    var unsubscribe = this.subscribe(function(evt) {
      if (resolveNext) {
        var r = resolveNext;
        resolveNext = null;
        r({ value: evt, done: false });
      } else {
        queue.push(evt);
      }
    });
    return {
      next: function() {
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift(), done: false });
        }
        return new Promise(function(resolve) { resolveNext = resolve; });
      },
      return: function() {
        unsubscribe();
        return Promise.resolve({ done: true });
      }
    };
  };

  function PyricSandboxAdapter(ref, userId, userColor) {
    this.ref_ = ref;
    this.userId_ = userId || 'sandbox-' + Math.random().toString(36).substring(2, 6);
    this.userColor_ = userColor || '#0000ff';
    this.revision_ = 0;
    this.ready_ = false;
    this.disposed_ = false;
    this.firebaseCallbacks_ = [];
    this.pendingRevisions_ = {};

    this.operations = new ReactiveStream();
    this.presence = new ReactiveStream();
    this.agentive = new ReactiveStream();

    var self = this;
    if (this.ref_ && typeof this.ref_.child === 'function') {
      setTimeout(function() { if (!self.disposed_) self.init_(); }, 0);
    } else {
      setTimeout(function() { if (!self.disposed_) { self.ready_ = true; self.trigger('ready'); } }, 0);
    }
  }
  if (firepad.utils && firepad.utils.makeEventEmitter) {
    firepad.utils.makeEventEmitter(PyricSandboxAdapter, ['ready', 'cursor', 'operation', 'ack', 'retry']);
  } else {
    utils.makeEventEmitter(PyricSandboxAdapter, ['ready', 'cursor', 'operation', 'ack', 'retry']);
  }

  PyricSandboxAdapter.prototype.init_ = function() {
    if (this.disposed_ || this.ready_) return;
    var self = this;
    var connRef = this.ref_.root ? this.ref_.root.child('.info/connected') : this.ref_.child('.info/connected');
    connRef.on('value', function(snap) {
      if (self.disposed_ || self.ready_) return;
      if (snap.val() === true) {
        self.monitorCursors_();
        self.monitorAgentive_();
        self.ref_.child('history').once('value', function(snapHistory) {
          if (!self.disposed_ && !self.ready_) {
            self.handleInitialRevisions_(snapHistory);
          }
        });
        self.monitorHistory_();
      }
    });
  };

  PyricSandboxAdapter.prototype.handleInitialRevisions_ = function(snap) {
    if (this.disposed_ || this.ready_) return;
    var revFn = (firepad.utils && firepad.utils.revisionToId) ? firepad.utils.revisionToId : function(r) { return 'A' + r.toString(36); };
    var val = snap && typeof snap.val === 'function' ? snap.val() : (snap || {});
    if (!val || typeof val !== 'object') val = {};

    var combined = Object.assign({}, val, this.pendingRevisions_);
    var doc = new firepad.TextOperation();
    var hasRevisions = false;

    var revId = revFn(this.revision_);
    while (combined[revId] != null) {
      var data = combined[revId];
      delete this.pendingRevisions_[revId];
      if (data && data.o) {
        try {
          var op = firepad.TextOperation.fromJSON(data.o);
          this.operations.push({ revision: this.revision_ + 1, operation: op, author: data.a, timestamp: data.t });
          doc = doc.compose(op);
          hasRevisions = true;
        } catch (e) {
          console.warn('Skipping uncomposable operation at revision ' + revId + ' during initialization:', e);
        }
      }
      this.revision_++;
      revId = revFn(this.revision_);
    }

    if (hasRevisions) {
      try {
        this.trigger('operation', doc);
      } catch (e) {
        console.warn('Failed to apply initial composed document:', e);
      }
    }

    this.ready_ = true;
    var self = this;
    setTimeout(function() {
      self.trigger('ready');
      self.handlePendingRevisions_();
    }, 0);
  };

  PyricSandboxAdapter.prototype.handlePendingRevisions_ = function() {
    var pending = this.pendingRevisions_;
    var revFn = (firepad.utils && firepad.utils.revisionToId) ? firepad.utils.revisionToId : function(r) { return 'A' + r.toString(36); };
    var revId = revFn(this.revision_);
    var triggerRetry = false;
    while (pending[revId] != null) {
      this.revision_++;
      var data = pending[revId];
      delete pending[revId];

      if (!data || !data.o) continue;
      var op = firepad.TextOperation.fromJSON(data.o);
      this.operations.push({ revision: this.revision_, operation: op, author: data.a, timestamp: data.t });

      if (this.sent_ && revId === this.sent_.id) {
        if ((typeof this.sent_.op.equals === 'function' ? this.sent_.op.equals(op) : true) && data.a === this.userId_) {
          this.sent_ = null;
          this.trigger('ack');
        } else {
          triggerRetry = true;
          this.trigger('operation', op);
        }
      } else {
        this.trigger('operation', op);
      }
      revId = revFn(this.revision_);
    }

    if (triggerRetry) {
      this.sent_ = null;
      this.trigger('retry');
    }
  };

  PyricSandboxAdapter.prototype.monitorHistory_ = function() {
    var self = this;
    this.ref_.child('history').on('child_added', function(snap) {
      if (self.disposed_) return;
      var revId = snap && typeof snap.key === 'string' ? snap.key : (snap && typeof snap.name === 'function' ? snap.name() : null);
      if (!revId) return;
      self.pendingRevisions_[revId] = snap && typeof snap.val === 'function' ? snap.val() : null;
      if (self.ready_) {
        self.handlePendingRevisions_();
      }
    });
  };

  PyricSandboxAdapter.prototype.monitorCursors_ = function() {
    var self = this;
    this.ref_.child('users').on('child_added', function(snap) {
      var uId = snap.key;
      if (uId === self.userId_) return;
      var data = snap.val();
      if (data && data.cursor && firepad.Cursor) {
        var cur = firepad.Cursor.fromJSON(data.cursor);
        self.presence.push({ userId: uId, cursor: cur, color: data.color || '#ff0000', state: 'active' });
        self.trigger('cursor', uId, cur, data.color || '#ff0000');
      }
    });
    this.ref_.child('users').on('child_changed', function(snap) {
      var uId = snap.key;
      if (uId === self.userId_) return;
      var data = snap.val();
      if (data && data.cursor && firepad.Cursor) {
        var cur = firepad.Cursor.fromJSON(data.cursor);
        self.presence.push({ userId: uId, cursor: cur, color: data.color || '#ff0000', state: 'active' });
        self.trigger('cursor', uId, cur, data.color || '#ff0000');
      }
    });
    this.ref_.child('users').on('child_removed', function(snap) {
      var uId = snap.key;
      self.presence.push({ userId: uId, cursor: null, color: '#ff0000', state: 'disconnected' });
      self.trigger('cursor', uId, null);
    });
  };

  PyricSandboxAdapter.prototype.monitorAgentive_ = function() {
    var self = this;
    this.ref_.child('agentive').on('child_added', function(snap) {
      var aId = snap.key;
      var data = snap.val();
      if (data && data.status) {
        self.agentive.push({ agentId: aId, status: data.status, ghostDiff: data.ghostDiff || null, explanation: data.explanation || '' });
      }
    });
    this.ref_.child('agentive').on('child_changed', function(snap) {
      var aId = snap.key;
      var data = snap.val();
      if (data && data.status) {
        self.agentive.push({ agentId: aId, status: data.status, ghostDiff: data.ghostDiff || null, explanation: data.explanation || '' });
      }
    });
  };

  PyricSandboxAdapter.prototype.sendOperation = function(operation, callback, author) {
    var self = this;
    if (!this.ready_) {
      this.on('ready', function() { self.sendOperation(operation, callback, author); });
      return;
    }
    var revFn = (firepad.utils && firepad.utils.revisionToId) ? firepad.utils.revisionToId : function(r) { return 'A' + r.toString(36); };
    var revStr = revFn(this.revision_);
    var actualAuthor = author || this.userId_;
    if (actualAuthor === this.userId_) {
      this.sent_ = { id: revStr, op: operation };
    }
    this.ref_.child('history').child(revStr).transaction(function(current) {
      if (current === null || current === undefined) {
        return {
          a: actualAuthor,
          o: typeof operation.toJSON === 'function' ? operation.toJSON() : operation,
          t: Date.now()
        };
      }
    }, function(err, committed) {
      if (callback) callback(err, committed);
    });
  };

  PyricSandboxAdapter.prototype.commitOperation = function(operation, author) {
    var self = this;
    return new Promise(function(resolve, reject) {
      function tryCommit(op) {
        self.sendOperation(op, function(err, committed) {
          if (committed) {
            resolve({ revision: self.revision_, committed: true });
          } else if (err) {
            reject(err);
          } else {
            if (typeof self.once === 'function') {
              self.once('retry', function() { tryCommit(op); });
            } else {
              var onRetry = function() {
                self.off('retry', onRetry);
                tryCommit(op);
              };
              self.on('retry', onRetry);
            }
          }
        }, author);
      }
      tryCommit(operation);
    });
  };

  PyricSandboxAdapter.prototype.sendCursor = function(cursor) {
    if (!this.ready_ || !this.ref_) return;
    var userRef = this.ref_.child('users/' + this.userId_);
    if (!cursor) {
      userRef.remove();
    } else {
      userRef.set({
        cursor: typeof cursor.toJSON === 'function' ? cursor.toJSON() : cursor,
        color: this.userColor_
      });
    }
  };

  PyricSandboxAdapter.prototype.broadcastPresence = function(cursor) {
    this.sendCursor(cursor);
    return Promise.resolve();
  };

  PyricSandboxAdapter.prototype.broadcastAgentive = function(agentId, status, ghostDiff, explanation) {
    if (!this.ready_ || !this.ref_) return Promise.resolve();
    return this.ref_.child('agentive/' + agentId).set({
      status: status,
      ghostDiff: ghostDiff ? (typeof ghostDiff.toJSON === 'function' ? ghostDiff.toJSON() : ghostDiff) : null,
      explanation: explanation || '',
      timestamp: Date.now()
    });
  };

  PyricSandboxAdapter.prototype.registerCallbacks = function(callbacks) {
    this.callbacks = callbacks || {};
    var self = this;
    this.on('ack', function() { if (self.callbacks && self.callbacks.ack) self.callbacks.ack(); });
    this.on('retry', function() { if (self.callbacks && self.callbacks.retry) self.callbacks.retry(); });
    this.on('operation', function(op) { if (self.callbacks && self.callbacks.operation) self.callbacks.operation(op); });
    this.on('cursor', function(id, cur, col) { if (self.callbacks && self.callbacks.cursor) self.callbacks.cursor(id, cur, col); });
  };

  PyricSandboxAdapter.prototype.isHistoryEmpty = function() {
    if (!this.ready_) throw new Error('not ready');
    return this.revision_ === 0;
  };

  PyricSandboxAdapter.prototype.setColor = function(c) { this.userColor_ = c; };
  PyricSandboxAdapter.prototype.setUserId = function(id) { this.userId_ = id; };

  PyricSandboxAdapter.prototype.dispose = function() {
    this.disposed_ = true;
    this.ready_ = false;
    this.callbacks = {};
    if (this.ref_ && typeof this.ref_.child === 'function') {
      try {
        var connRef = this.ref_.root ? this.ref_.root.child('.info/connected') : this.ref_.child('.info/connected');
        connRef.off();
        this.ref_.child('history').off();
        this.ref_.child('users').off();
        this.ref_.child('agentive').off();
        if (this.userId_) {
          this.ref_.child('users/' + this.userId_).remove();
        }
      } catch (e) {}
    }
    return Promise.resolve();
  };

  return {
    ReactiveStream: ReactiveStream,
    PyricSandboxAdapter: PyricSandboxAdapter,
    FirebaseRTDBAdapter: PyricSandboxAdapter
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = firepad.SyncSeam;
}
