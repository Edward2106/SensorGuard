import {readdir,lstat,unlink} from 'node:fs/promises';
import path from 'node:path';

// Only files created by SensorGuard's runtime logger, never arbitrary evidence.
const managed = /^sensorguard-(api|worker)-\d+(?:-[a-f0-9]{12})?\.log(?:\.\d+)?$/;
export async function retainLogs(directory, {maxAgeMs=7*86400000,maxTotalBytes=100*1024*1024,graceMs=120000,protectedFiles=[],now=Date.now()}={}) {
  if(!Number.isFinite(maxAgeMs)||maxAgeMs<=0||!Number.isSafeInteger(maxTotalBytes)||maxTotalBytes<1||!Number.isFinite(graceMs)||graceMs<0) throw new Error('Invalid log retention bounds');
  const protectedSet=new Set(protectedFiles), files=[];
  for(const name of await readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e;})) {
    if(!managed.test(name))continue;
    const info=await lstat(path.join(directory,name)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(info?.isFile())files.push({name,size:info.size,mtime:info.mtimeMs});
  }
  files.sort((a,b)=>a.mtime-b.mtime||a.name.localeCompare(b.name));
  let bytes=files.reduce((sum,f)=>sum+f.size,0);const removed=[];
  for(const file of files){
    if(protectedSet.has(file.name)||now-file.mtime<graceMs)continue;
    if(now-file.mtime<=maxAgeMs && bytes<=maxTotalBytes)continue;
    try {await unlink(path.join(directory,file.name));removed.push(file.name);bytes-=file.size;}
    catch(e){if(e.code!=='ENOENT')throw e;bytes-=file.size;}
  }
  return {removed,bytes,overBudget:bytes>maxTotalBytes};
}
