const http = require('node:http');

const PORT = process.env.PORT || 10000;
const ALLOWED_ORIGIN = 'https://pluto-burn-preflight.onrender.com';

// Use the current official mainnet hostname first. The older
// api.mainnet-beta.solana.com hostname has returned HTTP 403 for this app.
const UPSTREAMS = [
  'https://api.mainnet.solana.com',
  'https://solana-rpc.publicnode.com'
];

const ALLOWED_METHODS = new Set([
  'getVersion',
  'getSlot',
  'getBlockHeight',
  'getAccountInfo',
  'getTokenSupply',
  'getTokenAccountsByOwner',
  'getLatestBlockhash',
  'getFeeForMessage',
  'getMinimumBalanceForRentExemption',
  'simulateTransaction',
  'sendTransaction',
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

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(origin === ALLOWED_ORIGIN ? 204 : 403);
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
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
    res.writeHead(ok ? 200 : 502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok, service: 'pluto-solana-rpc-proxy', upstreams: checks }));
  }

  if (req.method !== 'POST' || req.url !== '/rpc' || origin !== ALLOWED_ORIGIN) {
    res.writeHead(403, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Forbidden' }));
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
      let lastError;
      for (const endpoint of UPSTREAMS) {
        try {
          const data = await callUpstream(endpoint, payload);
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          return res.end(JSON.stringify(data));
        } catch (error) {
          lastError = error;
        }
      }
      res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({
        error: 'All configured Solana RPC upstreams failed',
        detail: lastError?.message || 'unknown'
      }));
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON request' }));
    }
  });
});

server.listen(PORT, '0.0.0.0', () => process.stdout.write('Solana RPC proxy listening on ' + PORT + '\\n'));
