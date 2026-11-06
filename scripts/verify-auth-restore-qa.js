// Synthetic auth/session fixture only, never authenticates a staging account.
import mongoose from 'mongoose';
import express from 'express';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {authStore,initializeAuth} from '../src/security/store.js';
import {hashPassword,verifyPassword,digest} from '../src/security/password.js';
import {createSecurity} from '../src/security/auth.js';
assert.equal(process.env.MONGODB_URI,'mongodb://mongo:27029/sg_apm_qa');
const [mode,stamp]=process.argv.slice(2);assert.match(stamp,/^\d{13}$/);
const source='sg_v1_auth_source_'+stamp,target='sg_v1_auth_restore_'+stamp,file='/tmp/v1-auth-'+stamp+'.json';
await mongoose.connect(process.env.MONGODB_URI,{dbName:mode==='prepare'?source:target,autoIndex:false});
let server;
try {
 const opts=await mongoose.connection.db.admin().command({getCmdLineOpts:1});assert.equal(opts.parsed.storage.dbPath,'/scratch/phase9-mongo-9001');
 await initializeAuth();
 if(mode==='prepare'){
  assert.equal(await mongoose.connection.db.collection('auth_users').countDocuments(),0);
  const users=[];
  for(const role of ['ADMIN','OPERATOR','VIEWER']){
   const password=randomBytes(24).toString('hex'),token=randomBytes(32).toString('hex');
   const u=await authStore.createUser({username:'restore-'+role.toLowerCase(),passwordHash:await hashPassword(password),role});
   await authStore.saveSession({_id:digest(token),userId:u._id,version:0,expiresAt:new Date(Date.now()+3600000)});
   users.push({password,token,id:String(u._id),role});
  }
  fs.writeFileSync(file,JSON.stringify(users),{flag:'wx',mode:0o600});console.log(JSON.stringify({source,target,sessions:3}));
 }else{
  assert.equal(mode,'verify');const users=JSON.parse(fs.readFileSync(file));
  const security=createSecurity({store:authStore,config:{IS_PROD:false,AUTH_ORIGINS:['http://127.0.0.1:5173'],LEGACY_API_KEY_ENABLED:false}});
  const app=express();app.use('/api/v1',security.authenticate);app.get('/api/v1/probe',(req,res)=>res.json({role:req.auth.role}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  for(const u of users){const stored=await authStore.findUser('restore-'+u.role.toLowerCase());assert.ok(await verifyPassword(u.password,stored.passwordHash));
   const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/probe',{headers:{Cookie:'sg_session='+u.token}});assert.equal(r.status,200);assert.equal((await r.json()).role,u.role);
  }
  await authStore.updateUser(users[0].id,{disabled:true});
  assert.equal((await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/probe',{headers:{Cookie:'sg_session='+users[0].token}})).status,401);
  console.log(JSON.stringify({success:true,passwordHashesVerified:3,restoredSessionsAuthenticated:3,roles:['ADMIN','OPERATOR','VIEWER'],disabledSessionRejected:true}));
 }
}finally{if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();}
