// P3: PYRIC_SANDBOX=1 is the only switch that selects the test database.
// test/setup-globals.js must refuse to run without it instead of silently
// picking a backend.
var childProcess = require('child_process');
var nodePath = require('path');

describe('PYRIC_SANDBOX test switch', function() {
  var root = nodePath.resolve(__dirname, '..', '..');
  var probe = 'console.log("DB=" + firebase.database().constructor.name)';

  function runPreload(env) {
    var childEnv = Object.assign({}, process.env);
    delete childEnv.PYRIC_SANDBOX;
    delete childEnv.FIREBASE_REAL;
    delete childEnv.NODE_ENV;
    Object.assign(childEnv, env);
    return childProcess.spawnSync(process.execPath, ['--preload', './test/setup-globals.js', '-e', probe], {
      cwd: root,
      env: childEnv,
      encoding: 'utf8'
    });
  }

  it('uses the Pyric sandbox database when PYRIC_SANDBOX=1', function() {
    var result = runPreload({ PYRIC_SANDBOX: '1' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('DB=PyricDatabase');
  });

  it('fails loudly when PYRIC_SANDBOX is not set', function() {
    var result = runPreload({});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('PYRIC_SANDBOX=1');
  });

  it('does not treat NODE_ENV=test as the switch', function() {
    var result = runPreload({ NODE_ENV: 'test' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('PYRIC_SANDBOX=1');
  });
});
