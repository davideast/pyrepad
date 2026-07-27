/**
 * Initialization and network simulation script for PyricPad Playwright acceptance fixture.
 */

function createDisconnectableRef(baseRef) {
  var state = {
    offline: false,
    queuedOps: [],
    connListeners: [],
  };
  return new DisconnectableRef(baseRef, state, null);
}

function DisconnectableRef(realRef, state, existingRoot) {
  this.realRef = realRef;
  this.state = state;
  const isAlreadyRoot = !realRef.root || realRef.root === realRef;
  if (isAlreadyRoot) {
    this.root = this;
  } else {
    const defaultRoot = new DisconnectableRef(realRef.root, state, null);
    this.root = existingRoot || defaultRoot;
  }
}

DisconnectableRef.prototype.child = function (relPath) {
  return new DisconnectableRef(
    this.realRef.child(relPath),
    this.state,
    this.root,
  );
};

DisconnectableRef.prototype.parent = function () {
  var parentRef = this.realRef.parent();
  const hasParent = Boolean(parentRef);
  if (!hasParent) return null;
  return new DisconnectableRef(parentRef, this.state, this.root);
};

DisconnectableRef.prototype.push = function (val, cb) {
  var childRef = this.realRef.push();
  var wrapped = new DisconnectableRef(childRef, this.state, this.root);
  const hasValue = val !== undefined && val !== null;
  if (hasValue) {
    wrapped.set(val, cb);
  } else {
    const hasCallback = typeof cb === "function";
    if (hasCallback) cb(null);
  }
  return wrapped;
};

DisconnectableRef.prototype.on = function (eventType, callback, ctx, opts) {
  var refStr = this.toString();
  const isConnInfo = refStr.indexOf(".info/connected") >= 0;
  if (isConnInfo) {
    this.state.connListeners.push(callback);
    callback({ val: () => !this.state.offline });
    return;
  }
  const isOnline = !this.state.offline;
  if (isOnline) {
    this.realRef.on(eventType, callback, ctx, opts);
  }
};

DisconnectableRef.prototype.once = function (eventType, callback, ctx, opts) {
  const isOnline = !this.state.offline;
  if (isOnline) {
    this.realRef.once(eventType, callback, ctx, opts);
  }
};

DisconnectableRef.prototype.off = function (eventType, callback, ctx) {
  var refStr = this.toString();
  const isConnInfo = refStr.indexOf(".info/connected") >= 0;
  const shouldRemoveConnListener = isConnInfo && Boolean(callback);
  if (shouldRemoveConnListener) {
    this.state.connListeners = this.state.connListeners.filter(
      (listener) => listener !== callback,
    );
    return;
  }
  this.realRef.off(eventType, callback, ctx);
};

DisconnectableRef.prototype.set = function (val, cb) {
  const isOnline = !this.state.offline;
  if (isOnline) {
    return this.realRef.set(val, cb);
  }
  return new Promise((resolve) => {
    this.state.queuedOps.push({
      type: "set",
      ref: this.realRef,
      val: val,
      cb: cb,
      resolve: resolve,
    });
  });
};

DisconnectableRef.prototype.remove = function (cb) {
  const isOnline = !this.state.offline;
  if (isOnline) {
    return this.realRef.remove(cb);
  }
  return new Promise((resolve) => {
    this.state.queuedOps.push({
      type: "remove",
      ref: this.realRef,
      cb: cb,
      resolve: resolve,
    });
  });
};

DisconnectableRef.prototype.update = function (val, cb) {
  const isOnline = !this.state.offline;
  if (isOnline) {
    return this.realRef.update(val, cb);
  }
  return new Promise((resolve) => {
    this.state.queuedOps.push({
      type: "update",
      ref: this.realRef,
      val: val,
      cb: cb,
      resolve: resolve,
    });
  });
};

DisconnectableRef.prototype.transaction = function (updateFn, onComplete) {
  const isOnline = !this.state.offline;
  if (isOnline) {
    return this.realRef.transaction(updateFn, onComplete);
  }
  this.state.queuedOps.push({
    type: "transaction",
    ref: this.realRef,
    updateFn: updateFn,
    onComplete: onComplete,
  });
};

DisconnectableRef.prototype.toString = function () {
  const hasToStringMethod = typeof this.realRef.toString === "function";
  if (hasToStringMethod) return this.realRef.toString();
  return "disconnectable://ref";
};

DisconnectableRef.prototype.onDisconnect = function () {
  const hasDisconnectMethod = typeof this.realRef.onDisconnect === "function";
  if (hasDisconnectMethod) return this.realRef.onDisconnect();
  return { set: () => {}, remove: () => {} };
};

DisconnectableRef.prototype.setOfflineState = function (offline) {
  this.state.offline = offline;
  var listeners = [...this.state.connListeners];
  for (var i = 0; i < listeners.length; i++) {
    listeners[i]({ val: () => !offline });
  }
  const shouldReplay = !offline && this.state.queuedOps.length > 0;
  if (shouldReplay) {
    var queue = [...this.state.queuedOps];
    this.state.queuedOps = [];
    for (var j = 0; j < queue.length; j++) {
      executeQueuedOperation(queue[j]);
    }
  }
};

function executeQueuedOperation(op) {
  const isSet = op.type === "set";
  if (isSet) {
    op.ref.set(op.val, op.cb).then(op.resolve);
    return;
  }
  const isRemove = op.type === "remove";
  if (isRemove) {
    op.ref.remove(op.cb).then(op.resolve);
    return;
  }
  const isUpdate = op.type === "update";
  if (isUpdate) {
    op.ref.update(op.val, op.cb).then(op.resolve);
    return;
  }
  const isTransaction = op.type === "transaction";
  if (isTransaction) {
    op.ref.transaction(op.updateFn, op.onComplete);
  }
}

function initializeHarness() {
  var PyricSandbox = window.firepad && window.firepad.PyricSandbox;
  const isMissingSandbox = !PyricSandbox;
  if (isMissingSandbox) {
    console.error("PyricSandbox not found on window.firepad");
    return;
  }
  var db = PyricSandbox.createDatabase();
  var rootRef = db.ref("/playwright-journey");

  var refA = createDisconnectableRef(rootRef);
  var refB = createDisconnectableRef(rootRef);

  var containerA = document.getElementById("editor-container-a");
  var containerB = document.getElementById("editor-container-b");

  var cmA = window.CodeMirror(containerA, {
    lineNumbers: true,
    value: "",
  });
  var cmB = window.CodeMirror(containerB, {
    lineNumbers: true,
    value: "",
  });

  var padA = (window.Firepad || window.firepad).fromCodeMirror(refA, cmA, {
    userId: "Alice",
    userColor: "#ef4444",
    useSyncSeam: true,
    defaultText: "Initial shared collaboration text.\n",
  });

  var padB = (window.Firepad || window.firepad).fromCodeMirror(refB, cmB, {
    userId: "Bob",
    userColor: "#3b82f6",
    useSyncSeam: true,
  });

  window.testHarness = {
    padA: padA,
    padB: padB,
    cmA: cmA,
    cmB: cmB,
    refA: refA,
    refB: refB,
  };

  setupNetworkControls("a", refA);
  setupNetworkControls("b", refB);
}

const isDocumentReady = document.readyState !== "loading";
if (isDocumentReady) {
  initializeHarness();
} else {
  window.addEventListener("DOMContentLoaded", initializeHarness);
}

function setupNetworkControls(clientKey, disconnectableRef) {
  var btnDisconnect = document.getElementById("btn-disconnect-" + clientKey);
  var btnReconnect = document.getElementById("btn-reconnect-" + clientKey);
  var statusBadge = document.getElementById("status-" + clientKey);

  btnDisconnect.addEventListener("click", function () {
    disconnectableRef.setOfflineState(true);
    statusBadge.textContent = "offline";
    statusBadge.classList.remove("online");
    statusBadge.classList.add("offline");
    btnDisconnect.style.display = "none";
    btnReconnect.style.display = "inline-block";
  });

  btnReconnect.addEventListener("click", function () {
    disconnectableRef.setOfflineState(false);
    statusBadge.textContent = "online";
    statusBadge.classList.remove("offline");
    statusBadge.classList.add("online");
    btnReconnect.style.display = "none";
    btnDisconnect.style.display = "inline-block";
  });
}
