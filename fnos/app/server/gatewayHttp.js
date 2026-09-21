'use strict';

/**
 * Gateway prefix strip + static UI serving for FPK production entry.
 * Keeps /api/v1/* routes prefix-agnostic while iframe loads under /app/pome-panel.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

function stripGatewayPrefix(urlPath, prefix) {
  if (!prefix) return urlPath;
  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  if (urlPath === p) return '/';
  if (urlPath.startsWith(`${p}/`)) return urlPath.slice(p.length) || '/';
  return urlPath;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function tryServeStatic(req, res, urlPath, staticRoot) {
  if (!staticRoot || !fs.existsSync(staticRoot)) return false;
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (urlPath.includes('..')) return false;

  const resolvedRoot = path.resolve(staticRoot);
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  let filePath = path.resolve(resolvedRoot, rel.replace(/^\//, ''));
  if (!filePath.startsWith(resolvedRoot + path.sep) && filePath !== resolvedRoot) return false;

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    if (urlPath !== '/') return false;
    filePath = path.join(resolvedRoot, 'index.html');
    if (!fs.existsSync(filePath)) return false;
  }

  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Content-Length': body.length,
  });
  if (method === 'HEAD') {
    res.end();
    return true;
  }
  res.end(body);
  return true;
}

function wrapWithGatewayPrefix(app, { gatewayPrefix, staticRoot }) {
  const inner = app.handle;
  const server = http.createServer((req, res) => {
    Promise.resolve()
      .then(async () => {
        const host = req.headers.host || 'localhost';
        const u = new URL(req.url || '/', `http://${host}`);
        const stripped = stripGatewayPrefix(u.pathname, gatewayPrefix);
        const isApi = stripped === '/api' || stripped.startsWith('/api/');

        if (!isApi && tryServeStatic(req, res, stripped, staticRoot)) {
          return;
        }

        req.url = stripped + (u.search || '');
        await inner(req, res);
      })
      .catch((err) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal_error', message: String(err && err.message) }));
        }
      });
  });

  return {
    listenMode: app.listenMode,
    store: app.store,
    server,
    handle: app.handle,
    listenUnix(socketPath) {
      return new Promise((resolve, reject) => {
        try {
          if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
          fs.mkdirSync(path.dirname(socketPath), { recursive: true });
        } catch (err) {
          reject(err);
          return;
        }
        server.listen(socketPath, () => resolve({ socketPath }));
        server.on('error', reject);
      });
    },
    listenDevicePort(port = 0, host = '127.0.0.1') {
      const tcpPort = port == null || port === '' ? 0 : Number(port);
      if (!Number.isFinite(tcpPort) || tcpPort < 0) {
        return Promise.reject(new Error('invalid_device_port'));
      }
      return new Promise((resolve, reject) => {
        server.listen(tcpPort, host, () => {
          const addr = server.address();
          resolve({
            host,
            port: typeof addr === 'object' && addr ? addr.port : tcpPort,
          });
        });
        server.on('error', reject);
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

module.exports = {
  stripGatewayPrefix,
  contentTypeFor,
  tryServeStatic,
  wrapWithGatewayPrefix,
};
