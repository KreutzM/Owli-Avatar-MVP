#!/usr/bin/env node
// Optional foreground HTTPS endpoint. Does not create certificates or change host settings.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';

const bind = process.env.OWLI_HTTPS_BIND;
const port = Number(process.env.OWLI_HTTPS_PORT || '8443');
const cert = process.env.OWLI_HTTPS_CERT;
const key = process.env.OWLI_HTTPS_KEY;
const site = process.env.OWLI_WEB_DIST;
const apiPort = Number(process.env.OWLI_PROXY_API_PORT || '8765');
const allowedCidr = process.env.OWLI_ALLOWED_CIDR;

function ipv4Number(value) {
  if (net.isIP(value) !== 4) return null;
  return value.split('.').reduce((number, octet) => (number * 256 + Number(octet)) >>> 0, 0);
}

function parseCidr(value) {
  const match = typeof value === 'string' && value.match(/^((?:\d{1,3}\.){3}\d{1,3})\/(\d|[12]\d|3[0-2])$/);
  if (!match) return null;
  const address = ipv4Number(match[1]);
  const prefix = Number(match[2]);
  if (address === null || match[1].split('.').some(part => String(Number(part)) !== part)) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (address & mask) >>> 0;
  if (network !== address) return null;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const privateRanges = [[0x0a000000, 0x0affffff], [0xac100000, 0xac1fffff], [0xc0a80000, 0xc0a8ffff]];
  const loopbackTest = network === 0x7f000001 && prefix === 32;
  if (!loopbackTest && !privateRanges.some(([first, last]) => network >= first && broadcast <= last)) return null;
  if (prefix < 31 && (ipv4Number(bind) === network || ipv4Number(bind) === broadcast)) return null;
  return { network, mask, prefix, loopbackTest };
}

const cidr = parseCidr(allowedCidr);
const bindNumber = ipv4Number(bind);
if (!bind || net.isIP(bind) !== 4 || bind === '0.0.0.0' ||
    !cidr || (bindNumber & cidr.mask) >>> 0 !== cidr.network ||
    !Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535 || !cert || !key || !site || !path.isAbsolute(site)) {
  console.error('Set a specific LAN IPv4 address, matching private OWLI_ALLOWED_CIDR, PEM certificate/key and absolute OWLI_WEB_DIST; port must be 1024–65535.');
  process.exit(1);
}
const expectedHost = `${bind}:${port}`;
const allowedSource = remote => {
  const address = remote?.startsWith('::ffff:') ? remote.slice(7) : remote;
  const number = ipv4Number(address);
  return number !== null && ((number & cidr.mask) >>> 0) === cidr.network;
};
const root = fs.realpathSync(site);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key), minVersion: 'TLSv1.2' }, (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!allowedSource(req.socket.remoteAddress)) { res.writeHead(403).end(); return; }
  if (req.headers.host !== expectedHost) { res.writeHead(421).end(); return; }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.headers.origin !== `https://${expectedHost}` || req.headers['x-owli-request'] !== '1') {
      res.writeHead(403).end(); return;
    }
  }
  let url;
  try { url = new URL(req.url, 'https://local.invalid'); } catch { res.writeHead(400).end(); return; }
  let decodedPath;
  try { decodedPath = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  if (decodedPath === '/api/diagnostics') { res.writeHead(404).end(); return; }
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    const headers = { ...req.headers, host: `127.0.0.1:${apiPort}` };
    for (const name of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) delete headers[name];
    const upstream = http.request({ hostname: '127.0.0.1', port: apiPort, method: req.method, path: url.pathname + url.search, headers }, response => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    });
    upstream.setTimeout(130_000, () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
    req.pipe(upstream);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let filename;
  try {
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    filename = fs.realpathSync(path.resolve(root, '.' + relative));
    if (!filename.startsWith(root + path.sep) || !fs.statSync(filename).isFile()) throw new Error('not found');
  } catch { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', mime[path.extname(filename).toLowerCase()] || 'application/octet-stream');
  if (req.method === 'HEAD') { res.end(); return; }
  const file = fs.createReadStream(filename);
  file.on('error', () => res.destroy());
  file.pipe(res);
});
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.on('upgrade', (_req, socket) => socket.destroy());
server.listen(port, bind, () => console.log(`HTTPS listener started on configured address, port ${port}`));
