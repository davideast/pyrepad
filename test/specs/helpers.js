// Initialize the Firebase SDK
firebase.initializeApp({
  apiKey: "<API_KEY>",
  authDomain: "firepad-gh-tests.firebaseapp.com",
  databaseURL: "https://firepad-gh-tests.firebaseio.com",
});

// Loaded with vm.runInThisContext by test/setup-globals.js; specs read the `helpers` global.
globalThis.helpers = (function() {
  const TextOperation = firepad.TextOperation;

  // Seeded PRNG (mulberry32) so random specs are reproducible run to run.
  const SEED = 0x5eed;
  let state = SEED;

  const helpers = { };
  helpers.seed = function(seed) {
    state = seed >>> 0;
  };

  helpers.random = function() {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  helpers.randomInt = function(n) {
    return Math.floor(helpers.random() * n);
  };

  helpers.randomString = function(n) {
    let str = '';
    while (n--) {
      if (helpers.random() < 0.15) {
        str += '\n';
      } else {
        const chr = helpers.randomInt(26) + 97;
        str += String.fromCharCode(chr);
      }
    }
    return str;
  };

  const attrNames = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const attrValues = [-4, 0, 10, 50, '0', '10', 'a', 'b', 'c', true, false];

  helpers.randomAttributes = function(allowFalse) {
    const attributes = { };
    const count = helpers.randomInt(3);
    for(let i = 0; i < count; i++) {
      const name = attrNames[helpers.randomInt(attrNames.length)];
      const value = attrValues[helpers.randomInt(attrValues.length - (allowFalse ? 0 : 1))];
      attributes[name] = value;
    }

    return attributes;
  };

  helpers.randomAttributesArray = function(n) {
    const attributes = Array(n);
    for(let i = 0; i < n; i++) {
      attributes[i] = helpers.randomAttributes();
    }
    return attributes;
  };

  helpers.randomOperation = function(str, useAttributes) {
    const operation = new TextOperation();
    let left;
    while (true) {
      left = str.length - operation.baseLength;
      if (left === 0) { break; }
      const r = helpers.random();
      const l = 1 + helpers.randomInt(Math.min(left - 1, 20));
      if (r < 0.2) {
        operation.insert(helpers.randomString(l), (useAttributes ? helpers.randomAttributes() : { }));
      } else if (r < 0.4) {
        operation['delete'](l);
      } else {
        operation.retain(l, (useAttributes ? helpers.randomAttributes(/*allowFalse=*/true) : { }));
      }
    }
    if (helpers.random() < 0.3) {
      operation.insert(1 + helpers.randomString(10));
    }
    return operation;
  };

  // A random test generates random data to check some invariants. To increase
  // confidence in a random test, it is run repeatedly.
  // Each random test restarts the PRNG so its data does not depend on test order.
  helpers.randomTest = function(n, func) {
    return function () {
      helpers.seed(SEED);
      while (n--) {
        func();
      }
    };
  };

  function randomElement (arr) {
    return arr[helpers.randomInt(arr.length)];
  }

  return helpers;
})();
