'use strict';

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const { Readable, pipeline } = require('node:stream');
const zlib = require('node:zlib');
const { isPrivateAddress } = require('./main-services');

async function resolvePublicUrl(value, { lookup = dns.promises.lookup, signal } = {}) {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || hostname === 'localhost' || hostname.endsWith('.local')) throw new Error('invalid_or_private_url');
  let timer;
  let onAbort;
  const addresses = await new Promise((resolve, reject) => {
    onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => reject(new Error('dns_timeout')), 5000);
    Promise.resolve().then(() => lookup(hostname, { all: true, verbatim: true })).then(resolve, reject);
  }).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  });
  if (!addresses.length || addresses.some((row) => isPrivateAddress(row.address))) throw new Error('invalid_or_private_url');
  return { url, addresses };
}

async function validatePublicHttpUrl(value, dependencies) {
  try { return (await resolvePublicUrl(value, dependencies)).url; } catch { return null; }
}

// The connection uses exactly the addresses checked above. Keep the original
// hostname for Host/SNI and normal TLS verification; never follow redirects here.
async function fetchPublicHttp(value, options = {}, dependencies = {}) {
  const { url, addresses } = await resolvePublicUrl(value, { ...dependencies, signal: options.signal });
  const request = url.protocol === 'https:' ? (dependencies.httpsRequest || https.request)
    : (dependencies.httpRequest || http.request);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: options.method || 'GET', headers: options.headers, signal: options.signal,
      agent: false,
      lookup(_hostname, lookupOptions, callback) {
        const family = Number(lookupOptions.family) || 0;
        const matches = addresses.filter((row) => !family || row.family === family);
        if (!matches.length) return callback(new Error('address_family_unavailable'));
        if (lookupOptions.all) return callback(null, matches);
        callback(null, matches[0].address, matches[0].family);
      },
    }, (incoming) => {
      try {
        const status = incoming.statusCode;
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          for (const entry of Array.isArray(value) ? value : [value]) {
            if (entry !== undefined) headers.append(key, entry);
          }
        }
        if ([301, 302, 303, 307, 308].includes(status) && options.redirect === 'error') {
          incoming.destroy();
          return reject(new Error('redirect_not_allowed'));
        }
        let body = incoming;
        const encoding = headers.get('content-encoding');
        const decompressor = encoding === 'gzip' ? zlib.createGunzip()
          : encoding === 'deflate' ? zlib.createInflate()
            : encoding === 'br' ? zlib.createBrotliDecompress() : null;
        if (decompressor) {
          pipeline(incoming, decompressor, () => {});
          body = decompressor;
          headers.delete('content-encoding');
          headers.delete('content-length');
        }
        if ([204, 205, 304].includes(status) || options.method === 'HEAD') {
          incoming.resume();
          resolve(new Response(null, { status, headers }));
        } else {
          resolve(new Response(Readable.toWeb(body), { status, headers }));
        }
      } catch (error) { incoming.destroy(); reject(error); }
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

async function readLimitedBody(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('response_too_large');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}

module.exports = { validatePublicHttpUrl, fetchPublicHttp, readLimitedBody };
