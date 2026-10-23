// Read-only inventories and BSON digests; no document contents or secrets printed.
import { MongoClient } from 'mongodb';
import { createHash } from 'node:crypto';
const port = process.argv[2] || '27017';
if (!['27017', '27018'].includes(port)) throw new Error('Only local source/target ports allowed');
const client = new MongoClient(`mongodb://127.0.0.1:${port}`, { serverSelectionTimeoutMS: 5000 });
try {
  await client.connect();
  const db = client.db('sensorguard');
  const report = { capturedAt: new Date().toISOString(), host: '127.0.0.1', port, database: db.databaseName,
    version: (await db.admin().serverInfo()).version, collections: [] };
  for (const info of await db.listCollections().toArray()) {
    if (info.name.startsWith('system.')) continue;
    const hash = createHash('sha256');
    let count = 0;
    for await (const doc of db.collection(info.name, { raw: true }).find().sort({ _id: 1 })) {
      hash.update(doc); count++;
    }
    report.collections.push({ name: info.name, type: info.type, options: info.options,
      indexes: await db.collection(info.name).listIndexes().toArray(), count, bsonSHA256: hash.digest('hex') });
  }
  console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); }
