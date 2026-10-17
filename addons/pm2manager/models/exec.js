// Runs a command with an argument vector, never through a shell string. On Windows pm2 is a .cmd
// shim that execFile cannot start by itself, so it goes through cmd.exe /c: every argument
// that reaches it must already be validated against a strict pattern (no & | < > ^ % or quotes).
const { execFile } = require('child_process');

const IS_WINDOWS = process.platform === 'win32';
const SHIMS = ['pm2'];
const MAX_BUFFER = 16 * 1024 * 1024;

/** Resolves with stdout; rejects with an Error whose message is stderr (or the failure). */
exports.run = function (cmd, args, options = {}) {
  const viaCmd = IS_WINDOWS && SHIMS.includes(cmd);
  const file = viaCmd ? 'cmd.exe' : cmd;
  const argv = viaCmd ? ['/d', '/c', cmd].concat(args) : args;
  return new Promise((resolve, reject) => {
    execFile(file, argv, Object.assign({ windowsHide: true, maxBuffer: MAX_BUFFER }, options, { shell: false }), (err, stdout, stderr) => {
      if (err) {
        const message = String(stderr || '').trim() || (err.killed ? `${cmd} took too long and was stopped` : err.message);
        return reject(Object.assign(new Error(message), { stdout: String(stdout || ''), code: err.code }));
      }
      resolve(String(stdout || ''));
    });
  });
};

exports.IS_WINDOWS = IS_WINDOWS;
