import Redis from 'ioredis';
import { redisConnectionOptions } from '../config/redis.js';
import { env } from '../config/env.js';

const script = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and decoded.timestamp and decoded.timestamp > ARGV[1] then return 0 end
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1`;
let client;
export function getCacheClient(initialize = false) {
  if (!client && initialize) {
    client = new Redis({ ...redisConnectionOptions, lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, commandTimeout: 1500 });
    client.on('error', () => {});
    client.connect().catch(() => {});
  }
  return client;
}
export function closeReadingCache() { client?.disconnect(); client = undefined; }
export function createReadingCache(redis, ttl = env.READING_CACHE_TTL_SECONDS) {
  const key = (id) => `sensorguard:latest:${id}`;
  return {
    async get(id) {
      const raw = await redis.get(key(id));
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (value?.metadata?.sensorId !== id || !Number.isFinite(Date.parse(value.timestamp)) || !Number.isFinite(value.value)) throw new Error('Invalid cached reading');
      return value;
    },
    async put(reading) {
      const value = { ...reading, timestamp: new Date(reading.timestamp).toISOString() };
      return redis.eval(script, 1, key(reading.metadata.sensorId), value.timestamp, JSON.stringify(value), ttl);
    },
  };
}
