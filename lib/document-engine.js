var firepad = firepad || { };

firepad.DocumentEngine = (function() {
  'use strict';

  function DocumentEngine(adapter) {
    this.adapter_ = adapter;
  }

  DocumentEngine.prototype.registerCallbacks = function(callbacks) {
    if (this.adapter_ && this.adapter_.registerCallbacks) {
      this.adapter_.registerCallbacks(callbacks);
    }
  };

  DocumentEngine.prototype.applyOperation = function(operation) {
    if (this.adapter_ && this.adapter_.applyOperation) {
      return this.adapter_.applyOperation(operation);
    }
  };

  DocumentEngine.prototype.invertOperation = function(operation) {
    if (this.adapter_ && this.adapter_.invertOperation) {
      return this.adapter_.invertOperation(operation);
    }
    return operation;
  };

  DocumentEngine.prototype.getCursor = function() {
    return (this.adapter_ && this.adapter_.getCursor) ? this.adapter_.getCursor() : null;
  };

  DocumentEngine.prototype.setCursor = function(cursor) {
    if (this.adapter_ && this.adapter_.setCursor) this.adapter_.setCursor(cursor);
  };

  DocumentEngine.prototype.setOtherCursor = function(cursor, color, clientId) {
    if (this.adapter_ && this.adapter_.setOtherCursor) {
      return this.adapter_.setOtherCursor(cursor, color, clientId);
    }
    return { clear: function() {} };
  };

  DocumentEngine.prototype.getValue = function() {
    return (this.adapter_ && this.adapter_.getValue) ? this.adapter_.getValue() : '';
  };

  DocumentEngine.prototype.setValue = function(text) {
    if (this.adapter_ && this.adapter_.setValue) this.adapter_.setValue(text);
  };

  function PureHeadlessEngine(initialText) {
    this.text_ = initialText || '';
    this.callbacks_ = {};
  }
  PureHeadlessEngine.prototype.registerCallbacks = function(cb) { this.callbacks_ = cb || {}; };
  PureHeadlessEngine.prototype.applyOperation = function(operation) {
    this.text_ = operation.apply(this.text_);
  };
  PureHeadlessEngine.prototype.invertOperation = function(operation) {
    return operation.invert(this.text_);
  };
  PureHeadlessEngine.prototype.getCursor = function() { return null; };
  PureHeadlessEngine.prototype.setCursor = function() {};
  PureHeadlessEngine.prototype.setOtherCursor = function() { return { clear: function() {} }; };
  PureHeadlessEngine.prototype.getValue = function() { return this.text_; };
  PureHeadlessEngine.prototype.setValue = function(t) { this.text_ = t; };

  return {
    Wrapper: DocumentEngine,
    PureHeadlessEngine: PureHeadlessEngine,
    create: function(adapter) { return new DocumentEngine(adapter || new PureHeadlessEngine()); }
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = firepad.DocumentEngine;
}
