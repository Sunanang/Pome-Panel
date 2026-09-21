'use strict';

/**
 * Pure helpers for mock HTTP against createApp without binding ports.
 * Used by tests/fnos-*.test.js
 */
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

function createMockReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const req = new Readable({
    read() {
      if (body !== undefined && body !== null) {
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        this.push(buf);
      }
      this.push(null);
    },
  });
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), v]),
  );
  return req;
}

function createMockRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.bodyChunks = [];
  res.headersSent = false;
  res.writeHead = (code, headers) => {
    res.statusCode = code;
    res.headers = { ...headers };
    res.headersSent = true;
  };
  res.end = (chunk) => {
    if (chunk) res.bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    res.finished = true;
    res.emit('finish');
  };
  res.getBody = () => Buffer.concat(res.bodyChunks).toString('utf8');
  res.getJson = () => JSON.parse(res.getBody() || 'null');
  return res;
}

async function dispatch(app, opts) {
  const req = createMockReq(opts);
  const res = createMockRes();
  await app.handle(req, res);
  // allow microtask flush if handler deferred
  if (!res.finished) {
    await new Promise((resolve) => res.once('finish', resolve));
  }
  return res;
}

module.exports = {
  createMockReq,
  createMockRes,
  dispatch,
};
