// Offline output sink for a REAL Agent. Never forwards, decodes, or stores bodies.
import http from 'node:http';
const counts = {};
http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/summary') {
    res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(counts));
  }
  const kind = req.url.includes('trace') ? 'traces' : req.url.includes('stats') ? 'apmStats' : req.url.includes('input') || req.url.includes('logs') ? 'logs' : req.url.includes('series') ? 'series' : 'other';
  let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) { res.writeHead(413); return res.end(); } }
  const c = counts[kind] ||= { requests: 0, bytes: 0 }; c.requests++; c.bytes += bytes;
  res.setHeader('content-type', 'application/json'); res.end('{}');
}).listen(8080, '0.0.0.0');
