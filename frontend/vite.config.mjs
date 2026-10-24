import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { permitted } from './server/boundary.mjs';
export default defineConfig({
  plugins:[react(),{name:'local-session-gateway',configureServer(server){
    const target=new URL(process.env.SENSORGUARD_API_ORIGIN || 'http://127.0.0.1:3000');
    if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw new Error('Gateway upstream must be a loopback HTTP origin');
    let active=0, requests=0, windowStart=Date.now();
    server.middlewares.use(async(req,res,next)=>{
      if(!req.url?.startsWith('/api')) return next();
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
      if(!permitted(req)){res.statusCode=403;res.end('{"message":"Local dashboard request denied"}');return;}
      if(Date.now()-windowStart>60000){requests=0;windowStart=Date.now();}
      if(active>=8 || ++requests>180){res.statusCode=429;res.end('{"message":"Too many requests"}');return;}
      active++;
      try{
        let body;
        if(req.method!=='GET'){
          const parts=[];let size=0;
          for await(const chunk of req){size+=chunk.length;if(size>32768){res.statusCode=413;res.end('{}');return;}parts.push(chunk);}
          body=Buffer.concat(parts).toString();
          try {JSON.parse(body||'{}');}catch{res.statusCode=400;res.end('{"message":"Invalid JSON"}');return;}
        }
        const headers={'Content-Type':'application/json','X-SensorGuard-UI':'1'};
        if(req.headers.origin)headers.Origin=req.headers.origin;
        if(req.headers.cookie)headers.Cookie=req.headers.cookie;
        const upstream=await fetch(target.origin+req.url,{method:req.method,body,headers,redirect:'error',signal:AbortSignal.timeout(5000)});
        const cookies=upstream.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
        res.statusCode=upstream.status;res.end(await upstream.text());
      }catch{res.statusCode=502;res.end('{"message":"Backend unavailable"}');}
      finally{active--;}
    });
  }}],
  server:{host:'127.0.0.1',port:5173,strictPort:true,cors:false,fs:{strict:true,allow:[fileURLToPath(new URL('.',import.meta.url))]}},
});
