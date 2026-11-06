import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readdir,readFile,utimes,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {retainLogs} from '../src/observability/log-retention.js';
import {createLogger} from '../src/observability/logger.js';

test('runtime retention deletes only old managed files by age and total size',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sg-retain-')),now=Date.now();
 for(const [name,age] of [['sensorguard-api-1.log',10000],['sensorguard-worker-2.log.1',5000],['sensorguard-worker-3.log',0],['qa-evidence.json',20000]]){
  await writeFile(path.join(dir,name),'x'.repeat(100));await utimes(path.join(dir,name),(now-age)/1000,(now-age)/1000);
 }
 const r=await retainLogs(dir,{now,maxAgeMs:8000,maxTotalBytes:150,graceMs:0,protectedFiles:['sensorguard-worker-3.log']});
 assert.deepEqual(r.removed,['sensorguard-api-1.log','sensorguard-worker-2.log.1']);assert.equal(r.overBudget,false);
 assert.deepEqual((await readdir(dir)).sort(),['qa-evidence.json','sensorguard-worker-3.log']);
});
test('recent/active logs survive budget pressure and over-budget is explicit',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sg-retain-recent-'));await writeFile(path.join(dir,'sensorguard-worker-1.log'),'important');
 const r=await retainLogs(dir,{maxTotalBytes:1});assert.equal(r.overBudget,true);assert.equal(r.removed.length,0);
 await assert.rejects(retainLogs(dir,{maxTotalBytes:0}));
});
test('rotation, restart sessions, redaction and cleanup preserve recent worker errors',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sg-log-'));const make=()=>createLogger({directory:dir,maxBytes:600,stdout:()=>{},trace:()=>({}),service:'sensorguard-worker'});
 const first=make();for(let i=0;i<6;i++)first.error('important worker restart',{error:'Error',requestId:String(i)});await first.close();
 const before=await readdir(dir);assert.ok(before.some(f=>f.endsWith('.1')));
 const second=make();second.error('password=not-for-logs');await second.close();await second.retain();
 const after=await readdir(dir);assert.ok(before.every(f=>after.includes(f)));
 const content=(await Promise.all(after.map(f=>readFile(path.join(dir,f),'utf8')))).join('');assert.ok(content.includes('important worker restart'));assert.ok(!content.includes('not-for-logs'));assert.equal(second.stats.writeErrors,0);
});
test('retention does not follow symbolic links', {skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sg-link-')),outside=path.join(dir,'evidence.txt');await writeFile(outside,'preserved');await symlink(outside,path.join(dir,'sensorguard-api-9.log'));
 await retainLogs(dir,{maxTotalBytes:1,graceMs:0});assert.equal(await readFile(outside,'utf8'),'preserved');assert.ok((await readdir(dir)).includes('sensorguard-api-9.log'));
});
