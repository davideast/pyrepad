var firepad = firepad || { };

/**
 * Instance of headless Firepad for use in NodeJS. Supports get/set on text/html.
 */
firepad.Headless = (function() {
  var TextOperation   = firepad.TextOperation;
  var FirebaseAdapter = firepad.FirebaseAdapter;
  var EntityManager   = firepad.EntityManager;
  var ParseHtml       = firepad.ParseHtml;

  function Headless(refOrPath) {
    // Allow calling without new.
    if (!(this instanceof Headless)) { return new Headless(refOrPath); }

    var firebase, ref;
    if (typeof refOrPath === 'string') {
      if (window.firebase === undefined && typeof firebase !== 'object') {
        console.log("REQUIRING");
        firebase = require('firebase/app');
        require('firebase/database');
      } else {
        firebase = window.firebase;
      }

      ref = firebase.database().refFromURL(refOrPath);
    } else {
      ref = refOrPath;
    }

    this.entityManager_  = new EntityManager();

    this.firebaseAdapter_ = new FirebaseAdapter(ref);
    this.ready_ = false;
    this.zombie_ = false;
  }

  Headless.prototype.getDocument = function(callback) {
    var self = this;

    if (self.ready_) {
      return callback(self.firebaseAdapter_.getDocument());
    }

    self.firebaseAdapter_.on('ready', function() {
      self.ready_ = true;
      callback(self.firebaseAdapter_.getDocument());
    });
  }

  Headless.prototype.getText = function(callback) {
    if (this.zombie_) {
      throw new Error('You can\'t use a firepad.Headless after calling dispose()!');
    }

    this.getDocument(function(doc) {
      var text = doc.apply('');

      // Strip out any special characters from Rich Text formatting
      for (var key in firepad.sentinelConstants) {
        text = text.replace(new RegExp(firepad.sentinelConstants[key], 'g'), '');
      }
      callback(text);
    });
  }

  Headless.prototype.setText = function(text, callback) {
    if (this.zombie_) {
      throw new Error('You can\'t use a firepad.Headless after calling dispose()!');
    }

    var op = TextOperation().insert(text);
    this.sendOperationWithRetry(op, callback);
  }

  Headless.prototype.initializeFakeDom = function(callback) {
    if (typeof document === 'object' || typeof firepad.document === 'object') {
      callback();
    } else {
      var stubNode = function(tag, text) {
        this.nodeName = (tag || '').toUpperCase();
        this.childNodes = [];
        this.style = {};
        this.attributes = [];
        this.nodeValue = text || null;
        this.appendChild = function(c) { this.childNodes.push(c); return c; };
        this.getAttribute = function() { return null; };
        this.setAttribute = function() {};
      };
      firepad.document = {
        createElement: function(tag) { return new stubNode(tag); },
        createTextNode: function(txt) { var n = new stubNode('#text', txt); n.nodeType = 3; return n; }
      };
      callback();
    }
  };

  Headless.prototype.getHtml = function(callback) {
    var self = this;

    if (this.zombie_) {
      throw new Error('You can\'t use a firepad.Headless after calling dispose()!');
    }

    self.initializeFakeDom(function() {
      self.getDocument(function(doc) {
        callback(firepad.SerializeHtml(doc, self.entityManager_));
      });
    });
  };

  Headless.prototype.setHtml = function(html, callback) {
    var self = this;

    if (this.zombie_) {
      throw new Error('You can\'t use a firepad.Headless after calling dispose()!');
    }

    self.initializeFakeDom(function() {
      var textPieces = ParseHtml(html, self.entityManager_);
      var inserts    = firepad.textPiecesToInserts(true, textPieces);
      var op         = new TextOperation();

      for (var i = 0; i < inserts.length; i++) {
        op.insert(inserts[i].string, inserts[i].attributes);
      }

      self.sendOperationWithRetry(op, callback);
    });
  };

  Headless.prototype.getMarkdown = function(callback) {
    var self = this;
    if (this.zombie_) throw new Error('You can\'t use a firepad.Headless after calling dispose()!');
    self.getDocument(function(doc) {
      callback(firepad.PureFormatting ? firepad.PureFormatting.toMarkdown(doc) : '');
    });
  };

  Headless.prototype.setMarkdown = function(md, callback) {
    if (this.zombie_) throw new Error('You can\'t use a firepad.Headless after calling dispose()!');
    var op = firepad.PureFormatting ? firepad.PureFormatting.fromMarkdown(md) : new TextOperation().insert(md);
    this.sendOperationWithRetry(op, callback);
  };

  Headless.prototype.getAST = function(callback) {
    var self = this;
    if (this.zombie_) throw new Error('You can\'t use a firepad.Headless after calling dispose()!');
    self.getDocument(function(doc) {
      callback(firepad.PureFormatting ? firepad.PureFormatting.toAST(doc) : []);
    });
  };

  Headless.prototype.setAST = function(ast, callback) {
    if (this.zombie_) throw new Error('You can\'t use a firepad.Headless after calling dispose()!');
    var op = firepad.PureFormatting ? firepad.PureFormatting.fromAST(ast) : new TextOperation();
    this.sendOperationWithRetry(op, callback);
  };

  Headless.prototype.sendOperationWithRetry = function(operation, callback) {
    var self = this;

    self.getDocument(function(doc) {
      var op = operation.clone()['delete'](doc.targetLength);
      self.firebaseAdapter_.sendOperation(op, function(err, committed) {
        if (committed) {
          if (typeof callback !== "undefined") {
            callback(null, committed);
          }
        } else {
          self.sendOperationWithRetry(operation, callback);
        }
      });
    });
  };

  Headless.prototype.dispose = function() {
    this.zombie_ = true;
    this.firebaseAdapter_.dispose();
  };

  firepad.PureHeadless = Headless;
  return Headless;
})();
