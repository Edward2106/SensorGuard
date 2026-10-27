import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAnalyticsQuery,buildAnalyticsPipeline,summarizeSeries} from '../src/services/analytics.service.js';
import {allowed} from '../src/security/auth.js';
import {permitted} from '../frontend/server/boundary.mjs';
const base={sensorId:'s-1',from:'2026-01-01T00:00:00.000Z',to:'2026-01-01T01:00:00.000Z',granularity:'1m'};
test('analytics validates range, UTC calendar, granularity and bounded parameters',()=>{
 assert.equal(parseAnalyticsQuery(base).sensorId,'S-1');
 for(const change of [{sensorId:''},{sensorId:{$ne:null}},{from:'2026-02-30T00:00:00.000Z'},{to:base.from},{to:'2999-01-01T00:00:00Z'},{from:'2025-01-01T00:00:00Z'},{granularity:'__proto__'},{granularity:'bad'},{window:'2'},{window:'101'},{alpha:'NaN'},{alpha:'0'},{zThreshold:'11'},{foo:'bar'},{sensorId:['a','b']},{to:'2026-01-02T00:00:00.000Z'}])assert.throws(()=>parseAnalyticsQuery({...base,...change}),{statusCode:400});
 assert.equal(parseAnalyticsQuery({...base,to:'2026-01-02T00:00:00.000Z',granularity:'5m'}).bucketCount,288);
 assert.throws(()=>parseAnalyticsQuery({...base,from:'2026-01-01T07:00:00+07:00'}),{statusCode:400});
 assert.equal(parseAnalyticsQuery({...base,granularity:'1d'}).bucketCount,1);
});
test('pipeline matches sensor/type/unit/time first and only previous observations build the baseline',()=>{
 const p=buildAnalyticsPipeline(parseAnalyticsQuery(base),{type:'temperature',unit:'C'});
 assert.equal(p[0].$match['metadata.sensorId'],'S-1');assert.equal(p[0].$match.unit,'C');assert.ok(p[0].$match.timestamp.$lt);assert.equal(p[2].$limit,100001);
 const windows=p[3].$facet.series.filter(s=>s.$setWindowFields);
 assert.deepEqual(windows[0].$setWindowFields.output.movingAverage.window.documents,[-12,-1]);
 assert.equal(windows[1].$setWindowFields.output.ewmaBaseline.$shift.by,-1);
 assert.equal(JSON.stringify(p).includes('$out'),false);assert.equal(JSON.stringify(p).includes('$merge'),false);
});
test('weighted summary combines within and between bucket variance, not average of standard deviations',()=>{
 const result=summarizeSeries([{timestamp:'2026-01-01',min:1,max:3,avg:2,stdDev:1,count:2,anomaly:false},{timestamp:'2026-01-02',min:6,max:6,avg:6,stdDev:0,count:1,anomaly:true}]);
 assert.equal(result.count,3);assert.ok(Math.abs(result.avg-10/3)<1e-12);assert.ok(Math.abs(result.stdDev-Math.sqrt(38/9))<1e-12);assert.equal(result.anomalies,1);assert.equal(result.trend,'rising');assert.equal(summarizeSeries([]).avg,null);
});
test('analytics permissions preserve human roles and reject device credentials; gateway is read-only',()=>{
 for(const role of ['ADMIN','OPERATOR','VIEWER','service'])assert.equal(allowed(role,'GET','/analytics/series'),true);
 assert.equal(allowed('DEVICE','GET','/analytics/series'),false);
 const req={method:'GET',url:'/api/v1/analytics/series?sensorId=S-1',headers:{host:'127.0.0.1:5173','x-sensorguard-ui':'1'}};
 assert.equal(permitted(req),true);assert.equal(permitted({...req,method:'POST'}),false);
});
