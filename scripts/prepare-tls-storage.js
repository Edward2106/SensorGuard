// Prepare a NEW persistent volume from a verified backup. Does NOT touch/recreate staging.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const backup = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const qa = JSON.parse(fs.readFileSync('scratch/hardening-tls-qa.json', 'utf8'));
const hash = createHash('sha256').update(fs.readFileSync(path.join(backup.folder, 'caddy/pki/authorities/local/root.crt'))).digest('hex');
if (!qa.success || qa.originalCASha256 !== hash || backup.rootCertificateSha256 !== hash) throw Error('Verified QA and matching original CA required');
const name = 'sensorguard-phase8-staging_caddy_persistent_data';
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore','pipe','pipe'] }).trim();
if (docker(['volume', 'ls', '--format', '{{.Name}}']).split('\n').includes(name)) throw Error('Target volume already exists; refusing any overwrite');
docker(['volume', 'create', '--label', 'com.docker.compose.project=sensorguard-phase8-staging', '--label', 'com.docker.compose.volume=caddy_persistent_data', name]);
const helper = 'sensorguard-tls-storage-prepare-' + Date.now();
docker(['create', '--name', helper, '--mount', `source=${name},target=/data`, '--entrypoint', 'sh', 'caddy:2-alpine', '-c', 'sleep 3600']);
docker(['cp', path.join(backup.folder, 'caddy'), helper + ':/data/']);
docker(['start', helper]);
try {
  docker(['exec', helper, 'chmod', '-R', 'go-rwx', '/data/caddy']);
  if (!docker(['exec', helper, 'sha256sum', '/data/caddy/pki/authorities/local/root.crt']).startsWith(hash)) throw Error('Copied CA mismatch');
} finally { docker(['stop', helper]); }
const report = { volume: name, helper, originalCASha256: hash, prepared: true, stagingChanged: false,
  apply: 'Only with explicit downtime approval: compose.yml + compose.preview.yml + compose.tls-persistent.yml, recreate proxy only',
  rollback: 'Retain old volume and backup. If rollback is needed, create (do not start) original proxy configuration, restore backup/caddy to /root/.local/share/caddy with docker cp, then start and verify HTTPS using original CA. Never accept a newly generated CA as preserved trust.' };
fs.writeFileSync('scratch/hardening-tls-prepared.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
