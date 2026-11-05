import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { ensureTelemetryStorage } from '../src/services/telemetry.store.js';

const uri = process.env.PHASE9_TEST_MONGO_URI;
test('real MongoDB supports concurrent telemetry storage initialization on a fresh QA database', { skip: !uri, timeout: 30000 }, async () => {
  assert.equal(uri, 'mongodb://127.0.0.1:27029');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('sg_telemetry_boot_test_' + Date.now());
  let isolated = false;
  try {
    const options = await db.admin().command({ getCmdLineOpts: 1 });
    assert.equal(options.parsed.net.port, 27029);
    assert.match(options.parsed.storage.dbPath.replaceAll('\\', '/'), /\/scratch\/phase9-mongo-\d+$/);
    isolated = true;
    await Promise.all(Array.from({ length: 8 }, () => ensureTelemetryStorage(db)));
    const collection = await db.listCollections({ name: 'sensor_readings' }).next();
    assert.equal(collection.type, 'timeseries');
    assert.equal(collection.options.timeseries.timeField, 'timestamp');
    assert.equal(collection.options.timeseries.metaField, 'metadata');
    assert.equal(await db.collection('sensor_readings').countDocuments(), 0);
  } finally {
    if (isolated) await db.dropDatabase();
    await client.close();
  }
});
