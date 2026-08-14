#!/usr/bin/env node
/**
 * Portable `timeout(1)` replacement: with-timeout.mjs <seconds> <command> [args...]
 *
 * `timeout` is GNU coreutils and absent from stock macOS (Homebrew ships it as
 * `gtimeout`), and the obvious bash substitute is worse than it looks: a
 * `( sleep N; kill $pid ) &` watchdog inherits the caller's stdout, so a
 * `$(...)` capture cannot return until the *watchdog* exits — the whole timeout
 * elapses even when the real command finished immediately. That turned every
 * timed step into a wait for its full budget.
 *
 * Node is guaranteed present here (it is what we are testing), so this sidesteps
 * both the portability gap and the pipe-lifetime trap. Exits 124 on timeout, to
 * match GNU timeout.
 */
import { spawn } from 'node:child_process';

const [seconds, command, ...args] = process.argv.slice(2);

if (!seconds || !command) {
  process.stderr.write('usage: with-timeout.mjs <seconds> <command> [args...]\n');
  process.exit(2);
}

const ms = Number(seconds) * 1000;
if (!Number.isFinite(ms) || ms <= 0) {
  process.stderr.write(`with-timeout: invalid timeout "${seconds}"\n`);
  process.exit(2);
}

// stdio: 'inherit' hands the child our exact stdin/stdout/stderr, so redirects
// and pipes from the calling shell keep working and no extra process holds a
// pipe open after the child is gone.
const child = spawn(command, args, { stdio: 'inherit' });

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  child.kill('SIGKILL');
}, ms);

child.on('error', (err) => {
  clearTimeout(timer);
  process.stderr.write(`with-timeout: failed to run ${command}: ${err.message}\n`);
  process.exit(127);
});

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (timedOut) process.exit(124);
  if (signal) process.exit(128 + 9);
  process.exit(code ?? 0);
});
