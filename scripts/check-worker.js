import { heartbeatClient, readHeartbeats } from '../src/services/worker-heartbeat.js';
const client = heartbeatClient();
try { await new Promise((resolve,reject)=>{client.once('ready',resolve);client.once('error',reject);}); const result=await readHeartbeats(client);process.exitCode=result.status==='online'?0:1; }
catch {process.exitCode=1;} finally {client.disconnect();}
