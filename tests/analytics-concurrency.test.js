import {errorHandler} from '../src/middleware/error-handler.js';
import {test} from 'node:test';import assert from'node:assert/strict';import express from'express';import{createAnalyticsRouter}from'../src/routes/analytics.routes.js';
test('analytics concurrency budget returns429 and releases slots after completion',async()=>{
 let entered=0;let finish;const barrier=new Promise(r=>{finish=r;});
 const app=express();app.use(createAnalyticsRouter({database:()=>({}),run:async()=>{entered++;await barrier;return{data:[]};}}));
 app.use(errorHandler);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/series`;
 try{const tasks=Array.from({length:4},()=>fetch(url));await new Promise((r,j)=>{const start=Date.now();const timer=setInterval(()=>{if(entered===4){clearInterval(timer);r();}else if(Date.now()-start>3000){clearInterval(timer);j(Error('requests did not start'));}},10);});
 const busy=await fetch(url);assert.equal(busy.status,429);assert.equal(busy.headers.get('Retry-After'),'1');assert.equal((await busy.json()).error,'AppError');finish();for(const response of await Promise.all(tasks))assert.equal(response.status,200);assert.equal((await fetch(url)).status,200);
 }finally{finish();await new Promise(r=>server.close(r));}
});
