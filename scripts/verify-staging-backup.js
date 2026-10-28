import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import assert from 'node:assert/strict';
const file = process.argv[2] || 'scratch/hardening-data-backup.json';
const backup = JSON.parse(fs.readFileSync(file));
assert.equal(createHash('sha256').update(fs.readFileSync(backup.archive)).digest('hex'), backup.sha256);
const client = new MongoClient('mongodb://127.0.0.1:27029'); await client.connect();
try {
  const cmd = await client.db('admin').command({ getCmdLineOpts: 1 });
  assert.equal(cmd.parsed.net.port, 27029); assert.match(cmd.parsed.storage.dbPath.replaceAll('\\', '/'), /\/scratch\/phase9-mongo-\d+$/);
  const name = 'sg_hardening_restore_' + Date.now();
  assert.equal((await client.db('admin').admin().listDatabases()).databases.some(d => d.name === name), false);
  const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore','pipe','pipe'] });
  const archive = '/tmp/' + name + '.archive.gz';
  docker(['cp', backup.archive, 'sensorguard-phase9-mongo7-qa:' + archive]);
  docker(['exec', 'sensorguard-phase9-mongo7-qa', 'mongorestore', '--port=27029', '--archive=' + archive, '--gzip', '--nsInclude=sensorguard_staging.*', '--nsFrom=sensorguard_staging.*', '--nsTo=' + name + '.*']);
  const baseline = JSON.parse(fs.readFileSync('scratch/hardening-staging-baseline.ejson'));
  const db = client.db(name), counts = {};
  for (const collection of Object.keys(baseline.counts)) { counts[collection] = await db.collection(collection).countDocuments(); assert.equal(counts[collection], baseline.counts[collection]); }
  const options = (await db.listCollections({ name: 'sensor_readings' }).toArray())[0].options;
  assert.deepEqual(options, baseline.options.sensor_readings);
  assert.equal(await db.collection('auth_users').countDocuments(), 0);
  const restore = { database: name, counts, timeSeriesOptions: options, authUsers: 0, success: true };
  fs.writeFileSync(file, JSON.stringify({ ...backup, restored: true, restore }, null, 2)); console.log(JSON.stringify(restore));
} finally { await client.close(); }
