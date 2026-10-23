import { spawn } from 'node:child_process';
import { env } from '../src/config/env.js';
const role = process.argv[2];
if (!['api','worker'].includes(role)) throw new Error('Expected api or worker');
const child = spawn(process.execPath, ['--import','dd-trace/initialize.mjs',role === 'api' ? 'src/index.js' : 'src/worker.js'], {
  stdio:'inherit', env: { ...process.env, DD_SERVICE:`sensorguard-${role}`, DD_ENV:process.env.DD_ENV || env.NODE_ENV,
    DD_VERSION:'1.0.0', DD_PROFILING_ENABLED:'false', DD_RUNTIME_METRICS_ENABLED:'false', DD_APPSEC_ENABLED:'false', DD_DATA_STREAMS_ENABLED:'false' },
});
child.on('exit',code => { process.exitCode = code ?? 1; });
child.on('error',() => { process.exitCode = 1; });
