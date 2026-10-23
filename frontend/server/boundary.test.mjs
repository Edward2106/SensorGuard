import {test} from 'node:test';import assert from 'node:assert/strict';import {permitted} from './boundary.mjs';
const request=()=>({method:'GET',url:'/api/v1/ready',headers:{host:'127.0.0.1:5173','x-sensorguard-ui':'1','sec-fetch-site':'same-origin'}});
test('allows local dashboard reads',()=>assert.ok(permitted(request())));
test('blocks cross origin, rebinding and missing custom header',()=>{
 for(const headers of [{origin:'https://evil.example'},{host:'evil.example:5173'},{'x-sensorguard-ui':undefined},{'sec-fetch-site':'cross-site'}])assert.equal(permitted({...request(),headers:{...request().headers,...headers}}),false);
});
test('gateway denies unprotected mutations and unapproved paths',()=>{for(const change of [{method:'DELETE'},{method:'POST'},{url:'/api/v1/admin'},{url:'/api/v1/../sensors'}])assert.equal(permitted({...request(),...change}),false);});
test('same-origin JSON sensor and incident mutations are allowlisted',()=>{for(const [method,url] of [['POST','/api/v1/sensors'],['PATCH','/api/v1/sensors/SEN-1'],['DELETE','/api/v1/sensors/SEN-1'],['PATCH','/api/v1/alerts/ALT-1/resolve']])assert.equal(permitted({...request(),method,url,headers:{...request().headers,origin:'http://127.0.0.1:5173','content-type':'application/json'}}),true);});
test('cannot create incidents or publish readings through UI gateway',()=>{for(const url of ['/api/v1/alerts','/api/v1/readings'])assert.equal(permitted({...request(),method:'POST',url,headers:{...request().headers,origin:'http://127.0.0.1:5173','content-type':'application/json'}}),false);});
