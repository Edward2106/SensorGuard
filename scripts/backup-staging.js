// BSON application backup; credentials stay in the existing container environment.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const source = 'sensorguard-phase8-staging-mongo-1';
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore','pipe','pipe'] }).trim();
const inspected = JSON.parse(docker(['inspect', source]))[0];
if (inspected.Config.Labels?.['com.docker.compose.project'] !== 'sensorguard-phase8-staging' || inspected.State.Status !== 'running') throw Error('Expected existing staging MongoDB');
const stamp = Date.now(), archive = '/tmp/sg-hardening-' + stamp + '.archive.gz';
const code = `const{spawnSync}=require('child_process');const uri='mongodb://'+encodeURIComponent(process.env.MONGO_INITDB_ROOT_USERNAME)+':'+encodeURIComponent(process.env.MONGO_INITDB_ROOT_PASSWORD)+'@127.0.0.1:27017/sensorguard_staging?authSource=admin';const r=spawnSync('mongodump',['--uri',uri,'--archive=${archive}','--gzip','--excludeCollectionsWithPrefix=auth_'],{stdio:'ignore'});if(r.status!==0)throw Error('Application backup failed; no credentials logged');`;
docker(['exec', source, 'mongosh', '--quiet', '--nodb', '--eval', code]);
fs.mkdirSync('backups', { recursive: true });
const output = path.resolve('backups/sg-hardening-' + stamp + '.archive.gz');
if (fs.existsSync(output)) throw Error('Refusing backup overwrite');
docker(['cp', source + ':' + archive, output]);
const bytes = fs.readFileSync(output);
const report = { archive: output, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
  source: 'sensorguard_staging application collections; auth_* excluded', sourceUnchanged: true, restored: false };
fs.writeFileSync('scratch/hardening-data-backup.json', JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify(report));
