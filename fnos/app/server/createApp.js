'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createMemoryStore } = require('./store');
const { createRequestHandler } = require('./routes');

/**
 * Create an FPK API app for gateway (Unix) or device-port (TCP) listen modes.
 * Port is never hardcoded: pass 0 for ephemeral assignment.
 */
function createApp(options = {}) {
  const listenMode = options.listenMode === 'device-port' ? 'device-port' : 'gateway';
  const store = options.store || createMemoryStore({ serverId: options.serverId });
  const handler = createRequestHandler({
    store,
    listenMode,
    allowedOrigins: options.allowedOrigins,
  });
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error', message: String(err && err.message) }));
      }
    });
  });

  return {
    listenMode,
    store,
    server,
    handle: handler,
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
    /**
     * Optional device sync port. Pass port=0 (default) for OS-assigned ephemeral port.
     * A failed bind (for example EADDRINUSE) leaves the server idle so the caller can retry.
     * NEVER hardcode 5001.
     */
    listenDevicePort(port = 0, host = '127.0.0.1') {
      const tcpPort = port == null || port === '' ? 0 : Number(port);
      if (!Number.isInteger(tcpPort) || tcpPort < 0 || tcpPort > 65535) {
        return Promise.reject(new Error('invalid_device_port'));
      }
      return new Promise((resolve, reject) => {
        const onError = (err) => {
          cleanup();
          reject(err);
        };
        const onListening = () => {
          cleanup();
          const addr = server.address();
          resolve({
            host,
            port: typeof addr === 'object' && addr ? addr.port : tcpPort,
          });
        };
        function cleanup() {
          server.removeListener('error', onError);
          server.removeListener('listening', onListening);
        }
        server.on('error', onError);
        server.on('listening', onListening);
        try {
          server.listen(tcpPort, host);
        } catch (err) {
          cleanup();
          reject(err);
        }
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
  createApp,
};
