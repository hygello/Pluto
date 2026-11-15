const http = require('node:http');

const PORT = process.env.PORT || 10000;
const ALLOWED_ORIGIN = 'https://pluto-burn-preflight.onrender.com';
const UPSTREAMS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com'
];
const ALLOWED_METHODS = new Set(['getTokenSupply', 'getTokenAccountsByOwner']);

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(origin === ALLOWED_ORIGIN ? 204 : 403);
    return res.end();
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'pluto-readonly-solana-rpc' }));
  }
  if (req.method !== 'POST' || req.url !== '/rpc' || origin !== ALLOWED_ORIGIN) {
    res.writeHead(403, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Forbidden' }));
  }

  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 20000) req.destroy();
  });
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body);
      if (!payload || !ALLOWED_METHODS.has(payload.method)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'RPC method not allowed' }));
      }
      let lastError;
      for (const endpoint of UPSTREAMS) {
        try {
          const upstream = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(12000)
          });
          if (!upstream.ok) throw new Error('Upstream HTTP ' + upstream.status);
          const data = await upstream.json();
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          return res.end(JSON.stringify(data));
        } catch (err) {
          lastError = err;
        }
      }
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Solana RPC upstream unavailable', detail: lastError?.message || 'unknown' }));
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON request' }));
    }
  });
});

server.listen(PORT, '0.0.0.0', () => process.stdout.write('Readonly RPC proxy listening on ' + PORT + '\n'));
