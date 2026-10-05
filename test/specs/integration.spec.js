describe('Integration tests', function() {
  const h = helpers;
  const Firepad = firepad.Firepad;
  const Headless = Firepad.Headless;
  const extendedTimeoutLength = 300000;

  let _hiddenDiv;
  function hiddenDiv() {
    if (!_hiddenDiv) {
      _hiddenDiv = document.createElement('div');
      _hiddenDiv.style.display = 'none';
      document.body.appendChild(_hiddenDiv);
    }
    return _hiddenDiv;
  }

  function waitFor(check, callback) {
    const iid = setInterval(function() {
      if(check()){
        clearInterval(iid);
        callback();
      }
    }, 15);
  }

  function randomEdit (cm) {
    const length = cm.getValue().length;
    const start = h.randomInt(length);
    const startPos = cm.posFromIndex(start);
    const end = start + h.randomInt(Math.min(10, length - start));
    const endPos = cm.posFromIndex(end);
    const newContent = h.random() > 0.5 ? '' : h.randomString(h.randomInt(12));
    cm.replaceRange(newContent, startPos, endPos);
  }

  function randomChange (cm) {
    let n = 1 + h.randomInt(4);
    while (n--) {
      randomEdit(cm);
    }
  }

  function randomOperation (cm) {
    cm.operation(function() {
      randomChange(cm);
    });
  }

  let rootRef;

  beforeEach(function(done) {
    // Make sure we're connected to Firebase.  This can take a while on slow
    // connections.
    rootRef = firebase.database().ref();
    const connectedRef = rootRef.child('.info/connected');
    const connected = false;
    // The sandbox may fire synchronously, before `listener` is assigned (off() then gets undefined).
    let listener = undefined;
    listener = connectedRef.on('value', function(s) {
      if (s.val() == true) {
        done();
        connectedRef.off('value', listener);
      }
    });

    firebase.database().ref('1').remove();
    firebase.database().ref('2').remove();
  }, extendedTimeoutLength);

  // Passes locally, but times out of Travis regardless of timeout interval
  it('Out-of-order edit', function (done) {
    const ref = rootRef.push();
    const cm1 = CodeMirror(hiddenDiv());
    const cm2 = CodeMirror(hiddenDiv());
    const firepad1 = new Firepad(ref, cm1);
    const firepad2 = new Firepad(ref, cm2);

    firepad1.on('ready', function() {
      firepad1.setText('XXX3456789XXX');
      cm1.operation(function() {
        cm1.replaceRange('', {line: 0, ch: 10}, {line: 0, ch: 13});
        cm1.replaceRange('', {line: 0, ch: 0},  {line: 0, ch: 3});
      });
      cm2.on('change', function() {
        if (cm2.getValue() === '3456789') {
          expect(cm2.getValue()).toEqual('3456789');
          done();
        }
      });
    });
  }, extendedTimeoutLength);

  // Passes locally, but times out of Travis regardless of timeout interval
  it('Random text changes', function(done) {
    const ref = rootRef.push();
    const cm1 = CodeMirror(hiddenDiv());
    const cm2 = CodeMirror(hiddenDiv());
    const firepad1 = new Firepad(ref, cm1);
    const firepad2 = new Firepad(ref, cm2);

    function step(times) {
      if (times == 0) {
        expect(cm1.getValue()).toEqual(cm2.getValue());
        done();
      } else {
        randomOperation(cm1);
        waitFor(function() {
          return cm1.getValue() === cm2.getValue();
        }, function() {
          step(times - 1);
        });
      }
    }

    firepad1.on('ready', function() {
      firepad1.setText('lorem ipsum');
      step(25);
    });
  }, extendedTimeoutLength);

  it('Performs getHtml responsively', function(done) {
    const ref = rootRef.push();
    const cm = CodeMirror(hiddenDiv());
    const firepad = new Firepad(ref, cm);

    firepad.on('ready', function() {
      const html = '<b>bold</b>';
      firepad.setHtml(html);
      expect(firepad.getHtml()).toContain(html);
      done();
    });
  }, extendedTimeoutLength);

  it('Uses defaultText to initialize the pad properly', function(done) {
    const ref = rootRef.push();
    const cm = CodeMirror(hiddenDiv());
    const cm2 = CodeMirror(hiddenDiv());
    const text = 'This should be the starting text';
    const text2 = 'this is a new, different text';
    const firepad = new Firepad(ref, cm, { defaultText: text});

    firepad.on('ready', function() {
      expect(firepad.getText()).toEqual(text);
      firepad.setText(text2);
      const waitForSync = new Promise(function(resolve) {
        firepad.on('synced', function(isSync) { if (isSync) resolve(); });
      });
      waitForSync.then(function() {
        const firepad2 = new Firepad(ref, cm2, { defaultText: text});
        firepad2.on('ready', function() {
          if (firepad2.getText() == text2) {
            done();
          } else if (firepad2.getText() == text) {
            done(new Error('Default text won over edited text'));
          } else {
            done(new Error('Second Firepad got neither default nor edited text: ' + JSON.stringify(firepad2.getText())));
          }
        });
      });
    });
  });

  it('Emits sync events as users edit the pad', function(done) {
    const ref = rootRef.push();
    const cm = CodeMirror(hiddenDiv());
    const firepad = new Firepad(ref, cm, { defaultText: 'XXXXXXXX' });
    let startedSyncing = false;

    firepad.on('ready', function() {
      firepad.on('synced', function(synced) {
        if (!synced) startedSyncing = true;
        else if (startedSyncing) done();
      });
      cm.operation(function() {
        cm.replaceRange('edit', cm.posFromIndex(0));
      });
    });
  });

  it('Performs Firepad.dispose', function(done){
    const ref = rootRef.push();
    const cm = CodeMirror(hiddenDiv());
    const firepad = new Firepad(ref, cm, { defaultText: "It\'s alive." });

    firepad.on('ready', function() {
      firepad.dispose();
      // We'd like to know all firebase callbacks were removed.
      // This does not prove there was no leak but it shows we tried.
      expect(firepad.firebaseAdapter_.firebaseCallbacks_).toEqual([]);
      expect(function() { firepad.isHistoryEmpty(); }).toThrow();
      expect(function() { firepad.getText(); }).toThrow();
      expect(function() { firepad.setText("I'm a zombie.  Braaaains..."); }).toThrow();
      expect(function() { firepad.getHtml(); }).toThrow();
      expect(function() { firepad.setHtml("<p>I'm a zombie.  Braaaains...</p>"); }).toThrow();
      done();
    });
  });

  it('Safely performs Firepad.dispose immediately after construction', function(){
    const ref =rootRef.push();
    const cm = CodeMirror(hiddenDiv());
    const firepad = new Firepad(ref, cm);

    expect(function() {
      firepad.dispose();
    }).not.toThrow();
  });

  it('Performs headless get/set plaintext & dispose', function(done){
    const ref = rootRef.push();
    const cm = CodeMirror(hiddenDiv());
    const firepadCm = new Firepad(ref, cm);
    const firepadHeadless = new Headless(ref);

    const text = 'Hello from headless firepad!';

    firepadHeadless.setText(text, function() {
      firepadHeadless.getText(function(headlessText) {
        expect(headlessText).toEqual(firepadCm.getText());
        expect(headlessText).toEqual(text);

        firepadHeadless.dispose();
        // We'd like to know all firebase callbacks were removed.
        // This does not prove there was no leak but it shows we tried.
        expect(firepadHeadless.firebaseAdapter_.firebaseCallbacks_).toEqual([]);
        expect(function() { firepadHeadless.getText(function() {}); }).toThrow();
        expect(function() { firepadHeadless.setText("I'm a zombie.  Braaaains..."); }).toThrow();
	      done();
      });
    });
  });

  it('Performs headless get/set html & dispose', function(done) {
    const ref = rootRef.push();
    const cm = CodeMirror(hiddenDiv());
    const firepadCm = new Firepad(ref, cm);
    const firepadHeadless = new Headless(ref);

    const html =
      '<span style="font-size: 24px;">Rich-text editing with <span style="color: red">Firepad!</span></span><br/>\n' +
      '<br/>' +
      '<div style="font-size: 18px">' +
      'Supports:<br/>' +
      '<ul>' +
        '<li>Different ' +
          '<span style="font-family: impact">fonts,</span>' +
          '<span style="font-size: 24px;""> sizes, </span>' +
          '<span style="color: blue">and colors.</span>' +
        '</li>' +
        '<li>' +
          '<b>Bold, </b>' +
          '<i>italic, </i>' +
          '<u>and underline.</u>' +
        '</li>' +
        '<li>Lists' +
          '<ol>' +
            '<li>One</li>' +
            '<li>Two</li>' +
          '</ol>' +
        '</li>' +
        '<li>Undo / redo</li>' +
        '<li>Cursor / selection synchronization.</li>' +
        '<li>And it\'s all fully collaborative!</li>' +
      '</ul>' +
      '</div>';

    firepadHeadless.setHtml(html, function() {
      firepadHeadless.getHtml(function(headlessHtml) {
        expect(headlessHtml).toEqual(firepadCm.getHtml());

        firepadHeadless.dispose();
        // We'd like to know all firebase callbacks were removed.
        // This does not prove there was no leak but it shows we tried.
        expect(firepadHeadless.firebaseAdapter_.firebaseCallbacks_).toEqual([]);
        expect(function() { firepadHeadless.getHtml(function() {}); }).toThrow();
        expect(function() { firepadHeadless.setHtml("<p>I'm a zombie.  Braaaains...</p>"); }).toThrow();
        done();
      });
    });
  });

  it('Headless firepad takes a string path as well', function(done) {
    const ref = rootRef.push();
    const text = 'Hello from headless firepad!';
    const firepadHeadless = new Headless(ref.toString());

    firepadHeadless.setText(text, function() {
      firepadHeadless.getText(function(headlessText) {
        expect(headlessText).toEqual(text);
        done();
      });
    });
  });

  it('Ace editor', function (done) {
    const ref = rootRef.push();

    const editor = ace.edit(hiddenDiv().appendChild(document.createElement('div')));

    const text = '// JavaScript in Firepad!\nfunction log(message) {\n  console.log(message);\n}';
    const firepad = Firepad.fromACE(ref, editor);

    firepad.on('ready', function() {
      firepad.setText(text);
      expect(firepad.getText()).toEqual(text);
      done();
    });
  });

  it('Safely performs Headless.dispose immediately after construction', function(){
    const ref = rootRef.push();
    const firepadHeadless = new Headless(ref);

    expect(function() {
      firepadHeadless.dispose();
    }).not.toThrow();
  });

  it('Perform dispose - immediatly removes callbacks', function(done){
    const ref1 = rootRef.push();
    const cm = CodeMirror(hiddenDiv());

    expect(function() {
      const firepad = new Firepad(ref1, cm, { defaultText: 'Default Content'});
      firepad.dispose()
      // Wait some time for the callbacks to get called
      setTimeout(done, 1)
    }).not.toThrow();
  })

  it('Perform dispose - immediatly noop updates to text editor', function(done){
    const ref1 = firebase.database().ref('1').push();
    const ref2 = firebase.database().ref('2').push();

    const cm = CodeMirror(hiddenDiv());
    const firepad1 = new Firepad(ref1, cm);

    firepad1.on('ready', function() {
      // Add some text to Firepad
      expect(cm.getValue()).toEqual('');
      firepad1.setText('Test Content');

      // lib/firepad.js emits 'synced' again after dispose(); handle only the first one so the
      // test does not spawn a second firepad3 whose 'ready' races the end of the test.
      let handledSync = false;
      firepad1.on('synced', function(isSynced){
        if(isSynced && !handledSync) {
          handledSync = true;
          firepad1.dispose();
          cm.setValue('');

          // Create a new Firepad, using the same ref which we added text to, then dispose it
          const firepad2 = new Firepad(ref1, cm);
          firepad2.dispose()
          firepad2.on('ready', () => {
            expect(cm.getValue()).toEqual('Test Content');
          })
          cm.setValue('');
    
          // Create a new Firepad instance with a different ref
          // Should not contain text from previously disposed firepad
          const firepad3 = new Firepad(ref2, cm);
          firepad3.on('ready', function(synced) {
            expect(cm.getValue()).toEqual('');
            done();
          })
        }
      })
    })
  })
});
