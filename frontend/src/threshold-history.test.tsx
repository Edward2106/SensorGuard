import { test, expect } from 'vitest';
import { chartRows, type AnalyticsBucket } from './AnalyticsExplorer';
const bucket = (status:string): AnalyticsBucket => ({timestamp:'2026-01-01T00:00:00Z',availableAt:'2026-01-01T00:01:00Z',partial:false,min:25,max:25,avg:25,count:1,stdDev:0,movingAverage:null,baselineCount:0,baselineStdDev:null,ewma:25,ewmaBaseline:null,zScore:null,ewmaScore:null,anomaly:false,historicalThreshold:{status,revision:1,config:{type:'temperature',unit:'C',thresholds:{warningHigh:60}}}});
test('chart historical thresholds do not silently fall back to current thresholds',()=>{
  expect(chartRows([bucket('AVAILABLE')],60000)[0].warningHigh).toBe(60);
  for(const status of ['HISTORICAL_THRESHOLD_UNAVAILABLE','MIXED_CONFIGURATIONS','INCOMPATIBLE_TYPE_OR_UNIT'])expect(chartRows([bucket(status)],60000)[0].warningHigh).toBeNull();
});
test('chart threshold gaps stay null and data windows stay bounded',()=>{
  const rows=chartRows([bucket('AVAILABLE'),{...bucket('AVAILABLE'),timestamp:'2026-01-01T00:03:00Z',availableAt:'2026-01-01T00:04:00Z'}],60000);
  expect(rows).toHaveLength(3);expect(rows[1].avg).toBeNull();expect(rows[1].warningHigh).toBeUndefined();
  expect(chartRows(Array.from({length:1100},()=>bucket('AVAILABLE')),60000)).toHaveLength(1000);
});
