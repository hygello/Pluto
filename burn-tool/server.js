const http = require('node:http');

const PORT = process.env.PORT || 10000;
const ALLOWED_ORIGIN = 'https://pluto-burn-preflight.onrender.com';
const UPSTREAMS = [
  'https://api.mainnet.solana.com',
  'https://solana-rpc.publicnode.com'
];
const ALLOWED_METHODS = new Set([
  'getVersion','getSlot','getBlockHeight','getAccountInfo','getTokenSupply','getBalance',
  'getTokenAccountsByOwner','getLatestBlockhash','getFeeForMessage',
  'getMinimumBalanceForRentExemption','simulateTransaction','sendTransaction',
  'getSignatureStatuses'
]);

async function callUpstream(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const data = await response.json();
  if (data.error) throw new Error('RPC ' + data.error.code + ': ' + data.error.message);
  return data;
}

async function health(res) {
  const checks = await Promise.all(UPSTREAMS.map(async endpoint => {
    try {
      const result = await callUpstream(endpoint, {
        jsonrpc: '2.0', id: 1, method: 'getVersion', params: []
      });
      return { endpoint, ok: true, version: result.result?.['solana-core'] || 'reachable' };
    } catch (error) {
      return { endpoint, ok: false, error: error.message };
    }
  }));
  const ok = checks.some(check => check.ok);
  res.writeHead(ok ? 200 : 502, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  res.end(JSON.stringify({ ok, service: 'pluto-solana-rpc-proxy', upstreams: checks }));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  let pathname = new URL(req.url, 'http://localhost').pathname || '/';
  while (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  }

  // Public diagnostics are deliberately accessible without an Origin header.
  if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
    return health(res);
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(origin === ALLOWED_ORIGIN ? 204 : 403);
    return res.end();
  }

  if (req.method !== 'POST' || pathname !== '/rpc' || origin !== ALLOWED_ORIGIN) {
    res.writeHead(403, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      error: 'Forbidden',
      method: req.method,
      path: pathname,
      originAllowed: origin === ALLOWED_ORIGIN
    }));
  }

  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 100000) req.destroy();
  });
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body);
      if (!payload || !ALLOWED_METHODS.has(payload.method)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'RPC method not allowed' }));
      }
      let failures = [];
      for (const endpoint of UPSTREAMS) {
        try {
          const data = await callUpstream(endpoint, payload);
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          return res.end(JSON.stringify(data));
        } catch (error) {
          failures.push({ endpoint, error: error.message });
        }
      }
      res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'All configured Solana RPC upstreams failed', failures }));
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON request' }));
    }
  });
});

server.listen(PORT, '0.0.0.0', () => process.stdout.write('Solana RPC proxy listening on ' + PORT + '\\n'));
