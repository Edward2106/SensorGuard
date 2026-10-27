import{test}from'node:test';import assert from'node:assert/strict';import{getAnalytics}from'../src/services/analytics.service.js';
const query={sensorId:'S-1',from:'2026-01-01T00:00:00Z',to:'2026-01-01T01:00:00Z'};
const dbFor=aggregate=>({collection:name=>name==='sensors'?{findOne:async()=>({sensorId:'S-1',type:'temperature',unit:'C'})}:{aggregate}});
test('MongoDB budget timeout is an honest retryable error, not an empty result',async()=>{
 await assert.rejects(getAnalytics(dbFor(()=>({toArray:async()=>{throw Object.assign(new Error('timeout'),{code:50});}})),query),{statusCode:503});
});
test('sensor lookup timeout also respects the retryable analytics error contract',async()=>{
 const db={collection:()=>({findOne:async()=>{throw Object.assign(new Error('timeout'),{code:50});}})};
 await assert.rejects(getAnalytics(db,query),{statusCode:503});
});
test('raw reading overflow is rejected rather than silently truncated',async()=>{
 await assert.rejects(getAnalytics(dbFor(()=>({toArray:async()=>[{input:[{count:100001}],series:[]}]})),query),{statusCode:400});
});
