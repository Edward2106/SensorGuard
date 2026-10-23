import { ensureTelemetryStorage } from '../src/services/telemetry.store.js';
import { connectMongo, disconnectMongo } from '../src/config/db.js';

try {
  await connectMongo();
  await ensureTelemetryStorage();
  console.log('[Script] Time Series schema and telemetry ledger verified.');
} catch (error) {
  console.error('[Script] Time Series setup failed:', error.message);
  process.exitCode = 1;
} finally {
  await disconnectMongo();
}
