const { promisify } = require('util');
const { execFile } = require('child_process');

const execFileAsync = promisify(execFile);

const IS_WINDOWS = process.platform === 'win32';

// Every spawn the agent makes is now a fallback path (the PM2 RPC transport is the normal
// one), so these defaults exist to bound what a fallback can cost rather than to be fast.
const DEFAULTS = {
    windowsHide: true,
    encoding: 'utf8',
    // A child that never exits would otherwise hold its pipes, and the caller's request,
    // open forever.
    timeout: 30 * 1000,
    killSignal: 'SIGKILL',
    // Enough for `pm2 jlist` on a busy box; well short of letting a runaway child's output
    // exhaust the agent's heap.
    maxBuffer: 10 * 1024 * 1024
};

// Safe exec for commands with user-controlled arguments.
//
// On Windows, .cmd shims (pm2.cmd, node.cmd, …) cannot be invoked by execFile directly
// without shell:true — but shell:true + args triggers DEP0190 because Node concatenates the
// array into the shell string without escaping. Fix: delegate to cmd.exe /c with
// shell:false; args stay as a proper vector.
//
// On Linux and macOS the binary is executed directly, so there is no shell in the picture
// at all and nothing to escape.
async function safeExecFile(cmd, args, options = {}) {
    const finalCmd = IS_WINDOWS ? 'cmd.exe' : cmd;
    const finalArgs = IS_WINDOWS ? ['/c', cmd, ...args] : args;
    try {
        // shell: false is placed last so caller options cannot accidentally re-enable it
        const { stdout, stderr } = await execFileAsync(finalCmd, finalArgs, { ...DEFAULTS, ...options, shell: false });
        // PM2 writes progress and deprecation notices to stderr on a perfectly successful
        // run; only log it when there is something to say, and never treat it as failure.
        if (stderr && stderr.trim()) console.warn(`[agent] ${cmd} stderr: ${stderr.trim().slice(0, 500)}`);
        return stdout;
    } catch (err) {
        const detail = (err.stderr && err.stderr.trim()) || err.message;
        console.error(`[agent] exec failed: ${cmd} ${args.join(' ')} — ${detail}`);
        throw new Error(detail);
    }
}

module.exports = {
    IS_WINDOWS,
    safeExecFile
};
