import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../errors/app-errors.js';

export const GRANULARITIES = Object.freeze({
  '1m': { unit: 'minute', binSize: 1, ms: 60000 },
  '5m': { unit: 'minute', binSize: 5, ms: 300000 },
  '15m': { unit: 'minute', binSize: 15, ms: 900000 },
  '1h': { unit: 'hour', binSize: 1, ms: 3600000 },
  '1d': { unit: 'day', binSize: 1, ms: 86400000 },
});
export const ANALYTICS_LIMITS = Object.freeze({ days: 31, buckets: 1000, readings: 100000, maxTimeMS: 2500 });
function utcDate(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new BadRequestError(`${name} must be an ISO UTC timestamp ending in Z`);
  const date = new Date(value);
  if (!Number.isFinite(+date) || date.toISOString() !== (value.includes('.') ? value : value.replace('Z', '.000Z'))) throw new BadRequestError(`Invalid ${name}`);
  return date;
}
export function parseAnalyticsQuery(query, now = Date.now()) {
  if (Object.keys(query).some(k => !['sensorId','from','to','granularity','window','alpha','zThreshold'].includes(k)) || Object.values(query).some(v => typeof v !== 'string')) throw new BadRequestError('Unknown or repeated analytics parameter');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(query.sensorId || '')) throw new BadRequestError('A single sensorId is required');
  const from = utcDate(query.from, 'from'), to = utcDate(query.to, 'to');
  if (+from >= +to || +to > now || +to - +from > ANALYTICS_LIMITS.days * 86400000) throw new BadRequestError('Require from < to <= now and a range of at most 31 days');
  const granularity = query.granularity || '5m', interval = GRANULARITIES[granularity];
  if (!Object.hasOwn(GRANULARITIES, granularity)) throw new BadRequestError('granularity must be 1m, 5m, 15m, 1h or 1d');
  const bucketCount = Math.ceil(+to / interval.ms) - Math.floor(+from / interval.ms);
  if (bucketCount > ANALYTICS_LIMITS.buckets) throw new BadRequestError('Too many buckets; choose a coarser granularity');
  const window = Number(query.window ?? 12), alpha = Number(query.alpha ?? 0.2), zThreshold = Number(query.zThreshold ?? 3);
  if (!Number.isInteger(window) || window < 3 || window > 100 || !Number.isFinite(alpha) || alpha < 0.01 || alpha > 1 || !Number.isFinite(zThreshold) || zThreshold < 1 || zThreshold > 10) throw new BadRequestError('window: 3–100; alpha: 0.01–1; zThreshold: 1–10');
  return { sensorId: query.sensorId.toUpperCase(), from, to, granularity, interval, bucketCount, window, alpha, zThreshold };
}

export function buildAnalyticsPipeline(q, sensor) {
  const previous = { documents: [-q.window, -1] };
  const score = baseline => ({ $cond: [
    { $and: [{ $gte: ['$baselineCount', 3] }, { $gt: ['$baselineStdDev', 1e-12] }] },
    { $divide: [{ $subtract: ['$avg', baseline] }, '$baselineStdDev'] }, null,
  ] });
  return [
    { $match: { 'metadata.sensorId': q.sensorId, 'metadata.type': sensor.type, unit: sensor.unit, timestamp: { $gte: q.from, $lt: q.to }, value: { $type: 'number', $gte: -Number.MAX_VALUE, $lte: Number.MAX_VALUE } } },
    { $project: { _id: 0, timestamp: 1, value: 1 } },
    // Never return a silently truncated result. The facet count rejects overflow.
    { $limit: ANALYTICS_LIMITS.readings + 1 },
    { $facet: {
      input: [{ $count: 'count' }],
      series: [
        { $group: { _id: { $dateTrunc: { date: '$timestamp', unit: q.interval.unit, binSize: q.interval.binSize, timezone: 'UTC' } }, min: { $min: '$value' }, max: { $max: '$value' }, avg: { $avg: '$value' }, count: { $sum: 1 }, stdDev: { $stdDevPop: '$value' } } },
        { $setWindowFields: { sortBy: { _id: 1 }, output: {
          movingAverage: { $avg: '$avg', window: previous },
          baselineStdDev: { $stdDevSamp: '$avg', window: previous },
          baselineCount: { $sum: 1, window: previous },
          ewma: { $expMovingAvg: { input: '$avg', alpha: q.alpha } },
        } } },
        { $setWindowFields: { sortBy: { _id: 1 }, output: { ewmaBaseline: { $shift: { output: '$ewma', by: -1, default: null } } } } },
        { $set: { zScore: score('$movingAverage'), ewmaScore: score('$ewmaBaseline') } },
        { $set: { anomaly: { $or: [
          { $and: [{ $ne: ['$zScore', null] }, { $gte: [{ $abs: '$zScore' }, q.zThreshold] }] },
          { $and: [{ $ne: ['$ewmaScore', null] }, { $gte: [{ $abs: '$ewmaScore' }, q.zThreshold] }] },
        ] } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, timestamp: '$_id', min: 1, max: 1, avg: 1, count: 1, stdDev: 1, movingAverage: 1, baselineStdDev: 1, baselineCount: 1, ewma: 1, ewmaBaseline: 1, zScore: 1, ewmaScore: 1, anomaly: 1 } },
      ],
    } },
  ];
}

export function summarizeSeries(series) {
  const count = series.reduce((n, b) => n + b.count, 0);
  if (!count) return { count: 0, min: null, max: null, avg: null, stdDev: null, slopePerHour: null, trend: 'unavailable', anomalies: 0 };
  const avg = series.reduce((n, b) => n + b.avg * (b.count / count), 0);
  const variance = series.reduce((n, b) => n + (b.stdDev ** 2 + (b.avg - avg) ** 2) * (b.count / count), 0);
  const times = series.map(b => (+new Date(b.timestamp) - +new Date(series[0].timestamp)) / 3600000);
  const meanTime = times.reduce((a, b) => a + b, 0) / times.length;
  const meanBucket = series.reduce((n, b) => n + b.avg / series.length, 0);
  const divisor = times.reduce((n, t) => n + (t - meanTime) ** 2, 0);
  const slope = divisor ? series.reduce((n, b, i) => n + (times[i] - meanTime) * (b.avg - meanBucket), 0) / divisor : null;
  return { count, min: Math.min(...series.map(b => b.min)), max: Math.max(...series.map(b => b.max)), avg, stdDev: Math.sqrt(variance), slopePerHour: slope, trend: slope === null ? 'unavailable' : Math.abs(slope) < 1e-9 ? 'flat' : slope > 0 ? 'rising' : 'falling', anomalies: series.filter(b => b.anomaly).length };
}

export async function getAnalytics(db, query, now = Date.now()) {
  const q = parseAnalyticsQuery(query, now);
  try {
    const sensor = await db.collection('sensors').findOne({ sensorId: q.sensorId }, { projection: { _id: 0, sensorId: 1, name: 1, type: 1, unit: 1, thresholds: 1 }, maxTimeMS: 1000 });
    if (!sensor) throw new NotFoundError('Sensor not found');
    const [result] = await db.collection('sensor_readings').aggregate(buildAnalyticsPipeline(q, sensor), { maxTimeMS: ANALYTICS_LIMITS.maxTimeMS, allowDiskUse: false }).toArray();
    if ((result?.input[0]?.count || 0) > ANALYTICS_LIMITS.readings) throw new BadRequestError('More than 100000 readings; shorten the time range');
    const series = (result?.series || []).map(row => ({ ...row,
      availableAt: new Date(Math.min(+row.timestamp + q.interval.ms, +q.to)),
      partial: +row.timestamp < +q.from || +row.timestamp + q.interval.ms > +q.to,
    }));
    for (const row of series) for (const key of ['min','max','avg','stdDev','movingAverage','baselineStdDev','ewma','ewmaBaseline','zScore','ewmaScore']) {
      if (row[key] !== null && !Number.isFinite(row[key])) throw new BadRequestError('Numeric range exceeds analytics precision');
    }
    const summary = summarizeSeries(series);
    if (Object.values(summary).some(value => typeof value === 'number' && !Number.isFinite(value))) throw new BadRequestError('Numeric range exceeds analytics precision');
    return { data: { sensor, series, summary }, meta: {
      from: q.from, to: q.to, granularity: q.granularity, window: q.window, alpha: q.alpha, zThreshold: q.zThreshold,
      timezone: 'UTC', intervalMs: q.interval.ms, missingBuckets: q.bucketCount - series.length,
      baseline: 'Previous observed bucket means only; minimum 3; sample standard deviation; EWMA shifted by one bucket',
      scope: 'Finite numeric readings of current sensor type/unit only; [from,to); no pre-range history; event-time reconstruction may change with late arrivals; not ingestion-time backtesting or incident detection',
      limits: ANALYTICS_LIMITS,
    } };
  } catch (error) {
    if ([50, 292, 16819].includes(error.code)) throw new ServiceUnavailableError('Analytics resource budget exceeded; shorten the time range');
    throw error;
  }
}

