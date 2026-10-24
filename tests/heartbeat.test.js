import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHeartbeats } from '../src/services/worker-heartbeat.js';
import { literalPattern } from '../src/security/query.js';
test('missing Redis never implies worker health',async()=>assert.equal((await readHeartbeats({status:'reconnecting'})).status,'unavailable'));
test('expired heartbeat is stale, live heartbeat is independently online',async()=>{
 const fake={status:'ready',zrevrangebyscore:async()=>['a','b'],mget:async()=>[null,JSON.stringify({id:'b',status:'online',timestamp:100000})]};
 const result=await readHeartbeats(fake,100001);assert.equal(result.status,'online');assert.equal(result.workers[0].status,'stale');
 assert.equal((await readHeartbeats(fake,131000)).status,'degraded');
});
test('search regex is always literal',()=>{const value='(a+)+$.*';assert.equal(new RegExp(literalPattern(value)).test(value),true);assert.equal(new RegExp(literalPattern(value)).test('aaaa'),false);});
