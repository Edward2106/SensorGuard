import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { permitted } from './server/boundary.mjs';
export default defineConfig({
  plugins:[react(),{name:'local-read-gateway',configureServer(server){
    const config=parse(readFileSync(new URL('../.env',import.meta.url)));
    const key=process.env.API_KEY || config.API_KEY;
    if(!key) throw new Error('Configure backend API_KEY before starting frontend');
    let active=0, requests=0, windowStart=Date.now();
    server.middlewares.use(async(req,res,next)=>{
      if(!req.url?.startsWith('/api')) return next();
      res.setHeader('Cache-Control','no-store');
      if(!permitted(req)){res.statusCode=403;res.end('{"message":"Local dashboard request denied"}');return;}
      if(Date.now()-windowStart>60000){requests=0;windowStart=Date.now();}
      if(active>=8 || ++requests>180){res.statusCode=429;res.end('{"message":"Too many requests"}');return;}
      active++;
      try{
        let body;
        if(req.method!=='GET'){
          const parts=[];let size=0;
          for await(const chunk of req){size+=chunk.length;if(size>32768){res.statusCode=413;res.end('{}');return;}parts.push(chunk);}
          body=Buffer.concat(parts).toString();JSON.parse(body||'{}');
        }
        const upstream=await fetch('http://127.0.0.1:3000'+req.url,{method:req.method,body,headers:{'X-API-Key':key,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});
        res.statusCode=upstream.status;res.setHeader('Content-Type','application/json');res.end(await upstream.text());
      }catch{res.statusCode=502;res.end('{"message":"Backend unavailable"}');}
      finally{active--;}
    });
  }}],
  server:{host:'127.0.0.1',port:5173,strictPort:true,cors:false,fs:{strict:true,allow:[fileURLToPath(new URL('.',import.meta.url))]}},
});
