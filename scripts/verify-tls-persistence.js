// Isolated QA only. Keeps both containers and volumes for inspection; never recreates staging.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const backup = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rootPath = path.join(backup.folder, 'caddy/pki/authorities/local/root.crt');
const ca = fs.readFileSync(rootPath), hash = b => createHash('sha256').update(b).digest('hex');
if (!backup.matchesPreviouslyVerifiedCA || hash(ca) !== backup.rootCertificateSha256) throw Error('Verified backup required');
const id = Date.now(), volume = 'sensorguard-tls-qa-data-' + id;
const configVolume = 'sensorguard-tls-qa-config-' + id;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim();
for (const name of [volume, configVolume]) docker(['volume', 'create', '--label', 'sensorguard.purpose=tls-persistence-qa', name]);
const config = path.resolve('scratch/tls-qa-' + id + '.Caddyfile');
fs.writeFileSync(config, '{\n auto_https disable_redirects\n skip_install_trust\n}\nhttps://localhost {\n tls internal\n respond "SensorGuard TLS QA"\n}\n', { flag: 'wx' });
const prep = 'sensorguard-tls-qa-prepare-' + id;
docker(['create', '--name', prep, '--mount', `source=${volume},target=/data`, '--entrypoint', 'sh', 'caddy:2-alpine', '-c', 'sleep 3600']);
docker(['cp', path.join(backup.folder, 'caddy'), prep + ':/data/']);
docker(['start', prep]);
docker(['exec', prep, 'chmod', '-R', 'go-rwx', '/data/caddy']);
docker(['stop', prep]);
const request = () => new Promise((resolve, reject) => {
  const r = https.get({ hostname: 'localhost', family: 4, port: 8444, ca, rejectUnauthorized: true }, res => {
    let body = ''; res.on('data', b => body += b); res.on('end', () => resolve({ status: res.statusCode, body }));
  }); r.on('error', reject); r.setTimeout(3000, () => r.destroy(Error('QA TLS timeout')));
});
const report = { originalCASha256: hash(ca), backup: backup.folder, volume, configVolume, observations: [] };
for (const suffix of ['first', 'recreated']) {
  const name = 'sensorguard-tls-qa-' + suffix + '-' + id;
  docker(['run', '-d', '--name', name, '--label', 'sensorguard.purpose=tls-persistence-qa',
    '-p', '127.0.0.1:8444:443', '--memory', '128m', '--cpus', '0.25',
    '-e', 'XDG_DATA_HOME=/data', '-e', 'XDG_CONFIG_HOME=/config',
    '--mount', `source=${volume},target=/data`, '--mount', `source=${configVolume},target=/config`,
    '--mount', `type=bind,source=${config},target=/etc/caddy/Caddyfile,readonly`, 'caddy:2-alpine']);
  try {
    let result;
    for (let attempt = 0; attempt < 20; attempt++) {
      try { result = await request(); break; } catch (e) { if (attempt === 19) throw e; await new Promise(r => setTimeout(r, 250)); }
    }
    if (result.status !== 200 || result.body !== 'SensorGuard TLS QA') throw Error('QA response mismatch');
    const output = docker(['exec', name, 'sha256sum', '/data/caddy/pki/authorities/local/root.crt']);
    if (!output.startsWith(hash(ca))) throw Error('CA changed');
    report.observations.push({ name, status: 200, sameCA: true, tlsVerification: true });
  } finally { docker(['stop', name]); }
}
report.success = true;
fs.writeFileSync('scratch/hardening-tls-qa.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
