import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { startObserved } from '../scripts/start-observed.js';

test('observed launcher initializes ESM tracing and forwards shutdown to the child', () => {
  const parent = new EventEmitter(), child = new EventEmitter(), signals = [];
  child.kill = signal => signals.push(signal);
  let launch;
  startObserved('worker', { parent, spawnChild: (...args) => { launch = args; return child; } });
  assert.deepEqual(launch[1], ['--import', 'dd-trace/initialize.mjs', 'src/worker.js']);
  assert.equal(launch[2].env.DD_SERVICE, 'sensorguard-worker');
  assert.equal(launch[2].env.DD_REMOTE_CONFIG_ENABLED, 'false');
  parent.emit('SIGTERM'); parent.emit('SIGINT');
  assert.deepEqual(signals, ['SIGTERM', 'SIGINT']);
  child.emit('exit', 0, null);
  assert.equal(parent.exitCode, 0);
  assert.equal(parent.listenerCount('SIGTERM'), 0);
  assert.equal(parent.listenerCount('SIGINT'), 0);
});

test('observed launcher preserves failures, signal exits and spawn errors', () => {
  for (const [event, args, expected] of [
    ['exit', [7, null], 7], ['exit', [null, 'SIGTERM'], 143], ['error', [new Error('spawn failed')], 1],
  ]) {
    const parent = new EventEmitter(), child = new EventEmitter();
    startObserved('api', { parent, spawnChild: () => child });
    child.emit(event, ...args);
    assert.equal(parent.exitCode, expected);
    assert.equal(parent.listenerCount('SIGTERM'), 0);
  }
  assert.throws(() => startObserved('unknown'), /Expected api or worker/);
});

test('SIGTERM reaches an actual child which finishes its cleanup before exit', { timeout: 8000 }, async () => {
  const parent = new EventEmitter();
  const child = startObserved('worker', {
    parent,
    spawnChild: () => spawn(process.execPath, ['--input-type=module', '-e', `
      process.on('SIGTERM', () => {
        clearInterval(timer);
        process.stdout.write('cleanup-complete');
      });
      const timer = setInterval(() => {}, 1000);
      process.stdout.write('ready');
    `], { stdio: ['ignore', 'pipe', 'pipe'] }),
  });
  try {
    let output = '';
    child.stdout.on('data', data => { output += data; });
    const exited = once(child, 'exit');
    await once(child.stdout, 'data');
    parent.emit('SIGTERM');
    const [code, signal] = await exited;
    assert.equal(code, 0);
    assert.equal(signal, null);
    assert.equal(output, 'readycleanup-complete');
    assert.equal(parent.exitCode, 0);
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});
