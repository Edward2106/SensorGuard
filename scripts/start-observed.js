import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';

// Instrument before the ESM entry point, including its static imports.
export function startObserved(role, { spawnChild = spawn, parent = process } = {}) {
  if (!['api', 'worker'].includes(role)) throw new Error('Expected api or worker');
  const child = spawnChild(process.execPath, [
    '--import', 'dd-trace/initialize.mjs', role === 'api' ? 'src/index.js' : 'src/worker.js',
  ], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'inherit',
    env: {
      ...process.env,
      DD_SERVICE: `sensorguard-${role}`,
      DD_ENV: process.env.DD_ENV || env.NODE_ENV,
      DD_VERSION: '1.0.0',
      DD_PROFILING_ENABLED: 'false',
      DD_RUNTIME_METRICS_ENABLED: 'false',
      DD_APPSEC_ENABLED: 'false',
      DD_DATA_STREAMS_ENABLED: 'false',
      DD_REMOTE_CONFIG_ENABLED: 'false',
    },
  });
  const signals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => child.kill(signal)]));
  for (const [signal, forward] of signals) parent.on(signal, forward);
  const cleanup = () => {
    for (const [signal, forward] of signals) parent.removeListener(signal, forward);
  };
  child.once('exit', (code, signal) => {
    cleanup();
    parent.exitCode = code ?? (128 + (constants.signals[signal] || 1));
  });
  child.once('error', () => { cleanup(); parent.exitCode = 1; });
  return child;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startObserved(process.argv[2]);
}
