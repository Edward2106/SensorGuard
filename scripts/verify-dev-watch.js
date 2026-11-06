// Verify the narrowly scoped nodemon/minimatch override with real file watching.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const match=require('nodemon/lib/monitor/match');
const result=match(['src/index.js','README.md'],['**/*.js'],'js');
assert.equal(result.watched,1); assert.equal(result.ignored,1);
const dir=path.resolve('scratch','nodemon-compat-'+Date.now()); await mkdir(dir,{recursive:true});
const file=path.join(dir,'fixture.cjs'); await writeFile(file,"console.log('watch-start:1')");
const child=spawn(process.execPath,[require.resolve('nodemon/bin/nodemon.js'),'--legacy-watch','--watch',dir,'--ext','cjs','--delay','0.1',file],{stdio:['ignore','pipe','pipe'],env:{...process.env,NO_UPDATE_NOTIFIER:'1'}});
let output='',changed=false;
try {
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('nodemon restart timeout')),15000);
    const finish=fn=>value=>{clearTimeout(timer);fn(value);};
    child.once('error',finish(reject)); child.once('exit',()=>finish(reject)(new Error('nodemon exited before restart')));
    child.stdout.on('data',async data=>{
      output+=data;
      if(output.includes('watch-start:1')&&!changed){changed=true;await writeFile(file,"console.log('watch-start:2')");}
      if(output.includes('watch-start:2'))finish(resolve)();
    });
    child.stderr.on('data',()=>{});
  });
  console.log(JSON.stringify({status:'PASS',nodemon:require('nodemon/package.json').version,matcher:'11.x',globFiltering:true,realRestart:true}));
} finally {child.kill();}
