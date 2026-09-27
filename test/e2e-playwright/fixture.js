import { CodeMirror5Adapter } from "/src/editors/index.ts";

function createDisconnectableRef(baseRef) {
  const state = {
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
  const parentRef = this.realRef.parent();
  const hasParent = Boolean(parentRef);
  if (!hasParent) return null;
  return new DisconnectableRef(parentRef, this.state, this.root);
};

DisconnectableRef.prototype.push = function (val, cb) {
  const childRef = this.realRef.push();
  const wrapped = new DisconnectableRef(childRef, this.state, this.root);
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
  const refStr = this.toString();
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
  const refStr = this.toString();
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
  const listeners = [...this.state.connListeners];
  for (let i = 0; i < listeners.length; i++) {
    listeners[i]({ val: () => !offline });
  }
  const shouldReplay = !offline && this.state.queuedOps.length > 0;
  if (shouldReplay) {
    const queue = [...this.state.queuedOps];
    this.state.queuedOps = [];
    for (let j = 0; j < queue.length; j++) {
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
  const PyricSandbox = window.firepad && window.firepad.PyricSandbox;
  const isMissingSandbox = !PyricSandbox;
  if (isMissingSandbox) {
    console.error("PyricSandbox not found on window.firepad");
    return;
  }
  const db = PyricSandbox.createDatabase();
  const rootRef = db.ref("/playwright-journey");

  const refA = createDisconnectableRef(rootRef);
  const refB = createDisconnectableRef(rootRef);

  const containerA = document.getElementById("editor-container-a");
  const containerB = document.getElementById("editor-container-b");

  const cmA = window.CodeMirror(containerA, {
    lineNumbers: true,
    value: "",
  });
  const cmB = window.CodeMirror(containerB, {
    lineNumbers: true,
    value: "",
  });

  const padA = (window.Firepad || window.firepad).fromCodeMirror(refA, cmA, {
    userId: "Alice",
    userColor: "#ef4444",
    useSyncSeam: true,
    defaultText: "Initial shared collaboration text.\n",
  });

  const padB = (window.Firepad || window.firepad).fromCodeMirror(refB, cmB, {
    userId: "Bob",
    userColor: "#3b82f6",
    useSyncSeam: true,
  });

  const driverA = new CodeMirror5Adapter(cmA);
  const driverB = new CodeMirror5Adapter(cmB);

  window.testHarness = {
    padA: padA,
    padB: padB,
    cmA: cmA,
    cmB: cmB,
    refA: refA,
    refB: refB,
    driverA: driverA,
    driverB: driverB,
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
  const btnDisconnect = document.getElementById("btn-disconnect-" + clientKey);
  const btnReconnect = document.getElementById("btn-reconnect-" + clientKey);
  const statusBadge = document.getElementById("status-" + clientKey);

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
