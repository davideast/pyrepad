var firepad = firepad || { };

firepad.PyricSandbox = (function() {
  'use strict';

  function deepCopy(val) {
    if (val === undefined || val === null) return null;
    if (typeof val !== 'object') return val;
    return JSON.parse(JSON.stringify(val));
  }

  function getPathParts(pathStr) {
    return (pathStr || '').split('/').filter(Boolean);
  }

  function getValueAtPath(tree, parts) {
    var curr = tree;
    for (var i = 0; i < parts.length; i++) {
      if (curr === null || typeof curr !== 'object') return null;
      curr = curr[parts[i]];
      if (curr === undefined) return null;
    }
    return deepCopy(curr);
  }

  function resolveTimestamp(val) {
    if (val === undefined || val === null) return null;
    if (typeof val === 'object' && val['.sv'] === 'timestamp') {
      return Date.now();
    }
    if (Array.isArray(val)) {
      return val.map(resolveTimestamp);
    }
    if (typeof val === 'object') {
      var res = {};
      var keys = Object.keys(val);
      for (var i = 0; i < keys.length; i++) {
        res[keys[i]] = resolveTimestamp(val[keys[i]]);
      }
      return res;
    }
    return val;
  }

  function setValueAtPath(tree, parts, value) {
    value = resolveTimestamp(value);
    if (parts.length === 0) {
      return deepCopy(value);
    }
    var curr = tree;
    for (var i = 0; i < parts.length - 1; i++) {
      var p = parts[i];
      if (curr[p] === null || typeof curr[p] !== 'object') {
        curr[p] = {};
      }
      curr = curr[p];
    }
    var last = parts[parts.length - 1];
    if (value === null || value === undefined) {
      delete curr[last];
    } else {
      curr[last] = deepCopy(value);
    }
    return tree;
  }

  function DataSnapshot(ref, val) {
    this.ref = ref;
    this.key = ref.key;
    this._val = deepCopy(val);
  }

  DataSnapshot.prototype.val = function() {
    return deepCopy(this._val);
  };

  DataSnapshot.prototype.exists = function() {
    return this._val !== null && this._val !== undefined;
  };

  DataSnapshot.prototype.numChildren = function() {
    if (this._val !== null && typeof this._val === 'object') {
      return Object.keys(this._val).length;
    }
    return 0;
  };

  DataSnapshot.prototype.forEach = function(cb) {
    if (this._val !== null && typeof this._val === 'object') {
      var keys = Object.keys(this._val);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var childRef = this.ref.child(k);
        var childSnap = new DataSnapshot(childRef, this._val[k]);
        if (cb(childSnap) === true) break;
      }
    }
  };

  DataSnapshot.prototype.child = function(relPath) {
    var parts = getPathParts(relPath);
    var childVal = getValueAtPath(this._val, parts);
    return new DataSnapshot(this.ref.child(relPath), childVal);
  };

  function DatabaseQuery(ref, options) {
    this.ref = ref;
    this.db = ref.db;
    this.key = ref.key;
    this.pathStr = ref.pathStr;
    this.root = ref.root;
    this._options = options || {};
  }

  DatabaseQuery.prototype.on = function(eventType, callback, context) {
    return this.ref.on(eventType, callback, context, this._options);
  };

  DatabaseQuery.prototype.once = function(eventType, callback, context) {
    return this.ref.once(eventType, callback, context, this._options);
  };

  DatabaseQuery.prototype.off = function(eventType, callback, context) {
    return this.ref.off(eventType, callback, context);
  };

  DatabaseQuery.prototype.startAt = function(val, key) {
    return new DatabaseQuery(this.ref, Object.assign({}, this._options, { startAtVal: val, startAtKey: key }));
  };

  DatabaseQuery.prototype.endAt = function(val, key) {
    return new DatabaseQuery(this.ref, Object.assign({}, this._options, { endAtVal: val, endAtKey: key }));
  };

  DatabaseQuery.prototype.equalTo = function(val, key) {
    return new DatabaseQuery(this.ref, Object.assign({}, this._options, { equalToVal: val, equalToKey: key }));
  };

  DatabaseQuery.prototype.orderByKey = function() {
    return new DatabaseQuery(this.ref, Object.assign({}, this._options, { orderBy: 'key' }));
  };

  DatabaseQuery.prototype.orderByChild = function(child) {
    return new DatabaseQuery(this.ref, Object.assign({}, this._options, { orderBy: child }));
  };

  DatabaseQuery.prototype.orderByValue = function() {
    return new DatabaseQuery(this.ref, Object.assign({}, this._options, { orderBy: 'value' }));
  };

  DatabaseQuery.prototype.orderByPriority = function() {
    return new DatabaseQuery(this.ref, Object.assign({}, this._options, { orderBy: 'priority' }));
  };

  DatabaseQuery.prototype.limitToFirst = function(limit) {
    return new DatabaseQuery(this.ref, Object.assign({}, this._options, { limitToFirst: limit }));
  };

  DatabaseQuery.prototype.limitToLast = function(limit) {
    return new DatabaseQuery(this.ref, Object.assign({}, this._options, { limitToLast: limit }));
  };

  function DatabaseReference(db, pathStr) {
    this.db = db;
    this.pathStr = (pathStr || '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    var parts = getPathParts(this.pathStr);
    this.key = parts.length > 0 ? parts[parts.length - 1] : '';
    this.root = this.pathStr === '/' ? this : new DatabaseReference(db, '/');
  }

  DatabaseReference.prototype.child = function(relPath) {
    var newPath = (this.pathStr === '/' ? '' : this.pathStr) + '/' + relPath;
    return new DatabaseReference(this.db, newPath);
  };

  DatabaseReference.prototype.parent = function() {
    var parts = getPathParts(this.pathStr);
    if (parts.length === 0) return null;
    parts.pop();
    return new DatabaseReference(this.db, '/' + parts.join('/'));
  };

  DatabaseReference.prototype.push = function(val, cb) {
    var pushId = '-Mpyric_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    var childRef = this.child(pushId);
    if (val !== undefined && typeof val !== 'function') {
      childRef.set(val, cb);
    } else if (typeof val === 'function') {
      val(null);
    }
    return childRef;
  };

  DatabaseReference.prototype.set = function(val, cb) {
    var parts = getPathParts(this.pathStr);
    var oldVal = getValueAtPath(this.db._tree, parts);
    this.db._tree = setValueAtPath(this.db._tree, parts, val);
    this.db._triggerEvents(this.pathStr, oldVal, val);
    if (typeof cb === 'function') {
      setTimeout(function() { cb(null); }, 0);
    }
    return Promise.resolve();
  };

  DatabaseReference.prototype.remove = function(cb) {
    return this.set(null, cb);
  };

  DatabaseReference.prototype.update = function(val, cb) {
    if (val === null || typeof val !== 'object') {
      return this.set(val, cb);
    }
    var keys = Object.keys(val);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var parts = getPathParts(this.pathStr + '/' + k);
      var oldVal = getValueAtPath(this.db._tree, parts);
      this.db._tree = setValueAtPath(this.db._tree, parts, val[k]);
      this.db._triggerEvents(this.pathStr + '/' + k, oldVal, val[k]);
    }
    if (typeof cb === 'function') {
      setTimeout(function() { cb(null); }, 0);
    }
    return Promise.resolve();
  };

  DatabaseReference.prototype.transaction = function(updateFn, onComplete) {
    var parts = getPathParts(this.pathStr);
    var currVal = getValueAtPath(this.db._tree, parts);
    var newVal = updateFn(currVal);
    if (newVal === undefined) {
      var snap = new DataSnapshot(this, currVal);
      if (typeof onComplete === 'function') {
        setTimeout(function() { onComplete(null, false, snap); }, 0);
      }
      return Promise.resolve({ committed: false, snapshot: snap });
    }
    var oldVal = currVal;
    this.db._tree = setValueAtPath(this.db._tree, parts, newVal);
    var resultSnap = new DataSnapshot(this, newVal);
    this.db._triggerEvents(this.pathStr, oldVal, newVal);
    if (typeof onComplete === 'function') {
      setTimeout(function() { onComplete(null, true, resultSnap); }, 0);
    }
    return Promise.resolve({ committed: true, snapshot: resultSnap });
  };

  function matchesOptions(key, val, options) {
    if (!options) return true;
    var threshold = options.startAtKey !== undefined ? options.startAtKey : options.startAtVal;
    if (threshold !== undefined && threshold !== null) {
      if (String(key) < String(threshold)) return false;
    }
    var endThreshold = options.endAtKey !== undefined ? options.endAtKey : options.endAtVal;
    if (endThreshold !== undefined && endThreshold !== null) {
      if (String(key) > String(endThreshold)) return false;
    }
    return true;
  }

  DatabaseReference.prototype.on = function(eventType, callback, context, options) {
    var self = this;
    var listener = { path: this.pathStr, eventType: eventType, cb: callback, ctx: context, options: options, cancelled: false };
    this.db._listeners.push(listener);

    if (!listener.cancelled) {
      var currVal = getValueAtPath(this.db._tree, getPathParts(this.pathStr));
      if (eventType === 'value') {
        callback.call(context, new DataSnapshot(this, currVal));
      } else if (eventType === 'child_added' && currVal !== null && typeof currVal === 'object') {
        var keys = Object.keys(currVal).sort();
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (listener.cancelled) break;
          if (matchesOptions(k, currVal[k], options)) {
            callback.call(context, new DataSnapshot(this.child(k), currVal[k]));
          }
        }
      }
    }
    return callback;
  };

  DatabaseReference.prototype.once = function(eventType, callback, context, options) {
    var self = this;
    return new Promise(function(resolve) {
      var wrapped = function(snap) {
        self.off(eventType, wrapped, context);
        if (typeof callback === 'function') callback.call(context, snap);
        resolve(snap);
      };
      self.on(eventType, wrapped, context, options);
    });
  };

  DatabaseReference.prototype.off = function(eventType, callback, context) {
    var pathStr = this.pathStr;
    this.db._listeners = this.db._listeners.filter(function(l) {
      var match = (l.path === pathStr) &&
                  (!eventType || l.eventType === eventType) &&
                  (!callback || l.cb === callback) &&
                  (!context || l.ctx === context);
      if (match) {
        l.cancelled = true;
        return false;
      }
      return true;
    });
  };

  DatabaseReference.prototype.startAt = function(val, key) { return new DatabaseQuery(this).startAt(val, key); };
  DatabaseReference.prototype.endAt = function(val, key) { return new DatabaseQuery(this).endAt(val, key); };
  DatabaseReference.prototype.equalTo = function(val, key) { return new DatabaseQuery(this).equalTo(val, key); };
  DatabaseReference.prototype.orderByKey = function() { return new DatabaseQuery(this).orderByKey(); };
  DatabaseReference.prototype.orderByChild = function(child) { return new DatabaseQuery(this).orderByChild(child); };
  DatabaseReference.prototype.orderByValue = function() { return new DatabaseQuery(this).orderByValue(); };
  DatabaseReference.prototype.orderByPriority = function() { return new DatabaseQuery(this).orderByPriority(); };
  DatabaseReference.prototype.limitToFirst = function(limit) { return new DatabaseQuery(this).limitToFirst(limit); };
  DatabaseReference.prototype.limitToLast = function(limit) { return new DatabaseQuery(this).limitToLast(limit); };

  DatabaseReference.prototype.onDisconnect = function() {
    return {
      remove: function(cb) { return Promise.resolve(); },
      set: function(val, cb) { return Promise.resolve(); },
      cancel: function(cb) { return Promise.resolve(); }
    };
  };

  DatabaseReference.prototype.toString = function() {
    return 'pyric-sandbox://local' + this.pathStr;
  };

  function PyricDatabase() {
    this._tree = {
      '.info': {
        connected: true,
        serverTimeOffset: 0
      }
    };
    this._listeners = [];
  }

  PyricDatabase.prototype.ref = function(pathStr) {
    return new DatabaseReference(this, pathStr || '/');
  };

  PyricDatabase.prototype.refFromURL = function(url) {
    var parts = url.split(/.firebaseio\.com|.firebaseapp\.com|pyric-sandbox:\/\/local/);
    var pathStr = parts.length > 1 ? parts[1] : url;
    return this.ref(pathStr);
  };

  PyricDatabase.prototype._triggerEvents = function(targetPath, oldVal, newVal) {
    var self = this;
    var activeListeners = this._listeners.slice();
    setTimeout(function() {
      activeListeners.forEach(function(l) {
        if (l.cancelled) return;
        if (l.eventType === 'value') {
        if (targetPath === l.path || targetPath.indexOf(l.path === '/' ? '/' : l.path + '/') === 0 || (l.path.indexOf(targetPath === '/' ? '/' : targetPath + '/') === 0)) {
          var val = getValueAtPath(self._tree, getPathParts(l.path));
          var snap = new DataSnapshot(new DatabaseReference(self, l.path), val);
          l.cb.call(l.ctx, snap);
        }
      } else if (l.eventType === 'child_added') {
        var lPrefix = l.path === '/' ? '/' : l.path + '/';
        if (targetPath.indexOf(lPrefix) === 0 && targetPath.substring(lPrefix.length).indexOf('/') === -1) {
          var childKey = getPathParts(targetPath).pop();
          if ((oldVal === null || oldVal === undefined) && (newVal !== null && newVal !== undefined)) {
            if (matchesOptions(childKey, newVal, l.options)) {
              l.cb.call(l.ctx, new DataSnapshot(new DatabaseReference(self, targetPath), newVal));
            }
          }
        }
      } else if (l.eventType === 'child_removed') {
        var lPrefix = l.path === '/' ? '/' : l.path + '/';
        if (targetPath.indexOf(lPrefix) === 0 && targetPath.substring(lPrefix.length).indexOf('/') === -1) {
          var childKey = getPathParts(targetPath).pop();
          if ((oldVal !== null && oldVal !== undefined) && (newVal === null || newVal === undefined)) {
            if (matchesOptions(childKey, oldVal, l.options)) {
              l.cb.call(l.ctx, new DataSnapshot(new DatabaseReference(self, targetPath), oldVal));
            }
          }
        }
      } else if (l.eventType === 'child_changed') {
        var lPrefix = l.path === '/' ? '/' : l.path + '/';
        if (targetPath.indexOf(lPrefix) === 0 && targetPath.substring(lPrefix.length).indexOf('/') === -1) {
          var childKey = getPathParts(targetPath).pop();
          if ((oldVal !== null && oldVal !== undefined) && (newVal !== null && newVal !== undefined)) {
            if (matchesOptions(childKey, newVal, l.options)) {
              l.cb.call(l.ctx, new DataSnapshot(new DatabaseReference(self, targetPath), newVal));
            }
          }
        }
      }
    });
    }, 0);
  };

  return {
    Database: PyricDatabase,
    createDatabase: function() { return new PyricDatabase(); },
    DataSnapshot: DataSnapshot,
    DatabaseReference: DatabaseReference,
    DatabaseQuery: DatabaseQuery
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = firepad.PyricSandbox;
}
