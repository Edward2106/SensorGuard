export function permitted(req) {
 const h=req.headers, host=h.host;
 if(!['127.0.0.1:5173','localhost:5173'].includes(host)||h['x-sensorguard-ui']!=='1'||['cross-site','same-site'].includes(h['sec-fetch-site'])||(h.origin&&h.origin!=='http://'+host))return false;
 const url=req.url||''; if(url.length>2048||/%2f|%5c|\\|\.\./i.test(url))return false;
 const path=url.split('?')[0]; const id='[A-Za-z0-9_%.-]+';
 if(req.method==='GET')return new RegExp('^/api/v1/(health|ready|readings|sensors(?:/stats|/'+id+'(?:/readings(?:/latest)?)?)?|alerts(?:/stats|/'+id+')?)$').test(path);
 if(h.origin!=='http://'+host||!h['content-type']?.startsWith('application/json'))return false;
 return (req.method==='POST'&&path==='/api/v1/sensors')||(['PATCH','DELETE'].includes(req.method)&&new RegExp('^/api/v1/sensors/'+id+'$').test(path))||(req.method==='PATCH'&&new RegExp('^/api/v1/alerts/'+id+'/(acknowledge|resolve)$').test(path));
}
