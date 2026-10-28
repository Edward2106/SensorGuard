import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import mongoose from 'mongoose';
import { redisConnectionOptions } from '../config/redis.js';
import { env } from '../config/env.js';
const registry = `sg:workers:${env.MONGODB_DB_NAME}`;
export function heartbeatClient() {
  const client = new Redis({ ...redisConnectionOptions, maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 2000 });
  client.on('error', () => {});
  return client;
}
export function startHeartbeat(worker, { client = heartbeatClient(), now = () => Date.now(), id = randomUUID(), onHeartbeat = () => {} } = {}) {
  const key = `${registry}:${id}`;
  let closed = false, pending;
  const beat = () => {
    if (closed || pending) return;
    const timestamp = now();
    const status = worker.isRunning() && !worker.isPaused() && mongoose.connection.readyState === 1 ? 'online' : 'degraded';
    pending = client.multi().set(key, JSON.stringify({ id, status, timestamp }), 'EX', 30).zadd(registry, timestamp, id).zremrangebyscore(registry, '-inf', timestamp - 3600000).exec().then(result => { if (result?.every(([error]) => !error)) onHeartbeat(); }).catch(() => {}).finally(() => { pending = undefined; });
  };
  client.on('ready', beat);beat();const timer = setInterval(beat, 10000);timer.unref();
  return { id, async close() { closed = true;clearInterval(timer);await pending;try {await client.set(key, JSON.stringify({ id, status:'stopping', timestamp:now() }), 'EX', 30);}catch{}client.disconnect(); } };
}
export async function readHeartbeats(client, now = Date.now()) {
  if (client.status !== 'ready') return { status:'unavailable', workers:[] };
  const ids = await client.zrevrangebyscore(registry, '+inf', now - 3600000, 'LIMIT', 0, 100);
  if (!ids.length) return { status:'unavailable', workers:[] };
  const values = await client.mget(...ids.map(id => `${registry}:${id}`));
  const workers = values.map((value, i) => {
    try {const record=JSON.parse(value);return record && now-record.timestamp<=30000 ? record : {id:ids[i],status:'stale'};}
    catch {return {id:ids[i],status:'stale'};}
  });
  return { status:workers.some(w=>w.status==='online')?'online':'degraded', workers };
}
