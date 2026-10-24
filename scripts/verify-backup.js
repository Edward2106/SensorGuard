import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';

const SOURCE_URI = process.env.MONGODB_BACKUP_SOURCE_URI || 'mongodb://127.0.0.1:27028/sensorguard_staging';
const DOCKER_SOURCE_URI = 'mongodb://host.docker.internal:27028/sensorguard_staging';
const DISPOSABLE_DB = `sg_disposable_restore_${Date.now()}`;
const DOCKER_TARGET_URI = `mongodb://host.docker.internal:27028/${DISPOSABLE_DB}`;
const TARGET_URI = `mongodb://127.0.0.1:27028/${DISPOSABLE_DB}`;

// Never touch production or default development database
if (SOURCE_URI.includes('27017') || TARGET_URI.includes('27017')) {
  throw new Error('Refusing to run backup verification against port 27017 (development port)');
}

await mkdir('scratch/backups', { recursive: true });
const backupPath = path.resolve('scratch/backups/disposable-staging.gz');

console.log('[Backup] Starting BSON dump from isolated staging...');
const dumpStart = performance.now();
execFileSync('docker', [
  'run', '--rm',
  '-v', `${path.dirname(backupPath)}:/backup`,
  'mongo:7.0',
  'mongodump',
  `--uri=${DOCKER_SOURCE_URI}`,
  '--archive=/backup/disposable-staging.gz',
  '--gzip'
], { stdio: 'inherit' });
console.log(`[Backup] BSON dump completed in ${(performance.now() - dumpStart).toFixed(1)}ms`);

console.log(`[Restore] Restoring BSON archive to disposable DB ${DISPOSABLE_DB}...`);
const restoreStart = performance.now();
execFileSync('docker', [
  'run', '--rm',
  '-v', `${path.dirname(backupPath)}:/backup`,
  'mongo:7.0',
  'mongorestore',
  '--uri=mongodb://host.docker.internal:27028',
  '--archive=/backup/disposable-staging.gz',
  '--gzip',
  '--nsInclude=sensorguard_staging.*',
  '--nsFrom=sensorguard_staging.*',
  `--nsTo=${DISPOSABLE_DB}.*`
], { stdio: 'inherit' });
console.log(`[Restore] BSON restore completed in ${(performance.now() - restoreStart).toFixed(1)}ms`);

console.log('[Verify] Validating restored data against source data...');
const srcConn = await mongoose.createConnection(SOURCE_URI).asPromise();
const tgtConn = await mongoose.createConnection(TARGET_URI).asPromise();

try {
  const srcDb = srcConn.db;
  const tgtDb = tgtConn.db;

  const srcCols = await srcDb.listCollections().toArray();
  const tgtCols = await tgtDb.listCollections().toArray();

  const srcColNames = srcCols.map(c => c.name).sort();
  const tgtColNames = tgtCols.map(c => c.name).sort();

  console.log(`[Verify] Source collections (${srcColNames.length}):`, srcColNames);
  console.log(`[Verify] Restored collections (${tgtColNames.length}):`, tgtColNames);

  // Check all collections are restored
  for (const col of srcCols) {
    if (col.name.startsWith('system.views')) continue;
    const tgtCol = tgtCols.find(c => c.name === col.name);
    assert.ok(tgtCol, `Collection ${col.name} missing in restored DB`);
    assert.equal(tgtCol.type, col.type, `Collection ${col.name} type mismatch: expected ${col.type}, got ${tgtCol.type}`);

    if (col.type === 'timeseries') {
      assert.deepEqual(tgtCol.options.timeseries, col.options.timeseries, `Timeseries options mismatch for ${col.name}`);
    }

    const srcCount = await srcDb.collection(col.name).countDocuments();
    const tgtCount = await tgtDb.collection(col.name).countDocuments();
    assert.equal(tgtCount, srcCount, `Count mismatch for collection ${col.name}: source has ${srcCount}, restored has ${tgtCount}`);
    console.log(`[Verify] Collection "${col.name}" validated: exactly ${tgtCount} documents restored.`);
  }

  // Spot check sensor reading content
  const sampleReading = await tgtDb.collection('sensor_readings').findOne();
  assert.ok(sampleReading, 'Sample sensor reading must be retrievable from time series collection');
  assert.ok(sampleReading.timestamp instanceof Date, 'Restored timestamp must be Date');
  assert.ok(typeof sampleReading.value === 'number', 'Restored value must be number');
  assert.ok(sampleReading.metadata?.sensorId, 'Restored metadata.sensorId must exist');

  console.log('[Verify] Sample restored timeseries document verified successfully:');
  console.log('         sensorId:', sampleReading.metadata.sensorId);
  console.log('         timestamp:', sampleReading.timestamp.toISOString());
  console.log('         value:', sampleReading.value);

  console.log(`[Cleanup] Dropping disposable restored database ${DISPOSABLE_DB}...`);
  await tgtDb.dropDatabase();
  console.log('[Cleanup] Disposable database dropped.');

  console.log('BSON BACKUP & RESTORE VERIFICATION: SUCCESS');
} finally {
  await srcConn.close();
  await tgtConn.close();
  await unlink(backupPath).catch(() => {});
}
