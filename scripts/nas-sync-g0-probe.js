#!/usr/bin/env node
'use strict';

/**
 * G0 真机探测脚本（可执行清单 runner）
 *
 * ⚠️ 本脚本只在用户 x86 飞牛 NAS / 可达网关上跑。
 *    Cloud agent 不得宣称本脚本已在真机通过。
 *
 * 用法：
 *   node scripts/nas-sync-g0-probe.js \
 *     --base-url https://nas.example/app/pome-panel-sync \
 *     --channel lan|fnconnect|frp \
 *     --session web-logged-in|web-anonymous|desktop-no-cookie \
 *     --token <deviceToken|omit> \
 *     --out internal/nas-sync-g0/<date>/ \
 *     [--cookie 'name=value']
 *
 * 成功口径 ≠ health=200；须 identity isolation + Authorization 是否到达。
 * 详见 docs/nas-sync-g0-probe-checklist.md
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

function parseArgs(argv) {
  const out = {
    baseUrl: '',
    channel: 'lan',
    session: 'desktop-no-cookie',
    token: '',
    cookie: '',
    outDir: '',
    timeoutMs: 8000,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--base-url') { out.baseUrl = next; i += 1; }
    else if (arg === '--channel') { out.channel = next; i += 1; }
    else if (arg === '--session') { out.session = next; i += 1; }
    else if (arg === '--token') { out.token = next; i += 1; }
    else if (arg === '--cookie') { out.cookie = next; i += 1; }
    else if (arg === '--out') { out.outDir = next; i += 1; }
    else if (arg === '--timeout-ms') { out.timeoutMs = Number(next) || 8000; i += 1; }
    else if (arg === '--help' || arg === '-h') { out.help = true; }
  }
  return out;
}

function redact(value) {
  if (value == null) return value;
  const text = String(value);
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***REDACTED***')
    .replace(/"deviceToken"\s*:\s*"[^"]+"/gi, '"deviceToken":"***REDACTED***"')
    .replace(/"token"\s*:\s*"[^"]+"/gi, '"token":"***REDACTED***"')
    .replace(/"csrfToken"\s*:\s*"[^"]+"/gi, '"csrfToken":"***REDACTED***"')
    .replace(/code=[0-9A-Za-z\-_]{4,}/g, 'code=***REDACTED***');
}

function fetchJson(targetUrl, { method = 'GET', headers = {}, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (error) {
      resolve({ ok: false, error: 'invalid_url', message: String(error && error.message) });
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: { Accept: 'application/json', ...headers },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            body = { _nonJson: true, preview: raw.slice(0, 200) };
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: res.headers,
            body,
            raw: redact(raw),
          });
        });
      },
    );
    req.on('error', (error) => {
      resolve({
        ok: false,
        error: error.code || 'request_failed',
        message: String(error.message || error),
        certificateError: /cert|SSL|TLS|UNABLE_TO_VERIFY/i.test(String(error.message || error)),
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.end();
  });
}

function joinApi(baseUrl, apiPath) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = String(apiPath || '').replace(/^\/+/, '');
  return `${base}/${suffix}`;
}

function expectedMatrixCell({ session, hasToken }) {
  // From nas-sync-p0-tasks.md §0.2 — agent records actual vs expected; does not claim pass.
  if (session === 'web-logged-in' && !hasToken) {
    return { me: '200', authProbe: 'optional', note: 'me=200 uid correct; business web ok' };
  }
  if (session === 'web-anonymous' && !hasToken) {
    return { me: '401/403', authProbe: '401', note: 'unauthenticated web rejected' };
  }
  if (session === 'desktop-no-cookie' && hasToken) {
    return { me: 'n/a-or-401', authProbe: '200', note: 'auth-probe accepts Bearer; uid = token owner' };
  }
  if (session === 'desktop-no-cookie' && !hasToken) {
    return { me: 'n/a-or-401', authProbe: '401', note: 'no token → auth-probe 401' };
  }
  if (session === 'desktop-invalid-token') {
    return { me: 'n/a-or-401', authProbe: '401', note: 'revoked/invalid token rejected' };
  }
  if (session === 'web-logged-in-cross-uid-token') {
    return { me: 'single-subject', authProbe: 'reject-or-single', note: 'must not cross uid' };
  }
  return { me: 'unspecified', authProbe: 'unspecified', note: 'custom session — fill expected manually' };
}

function judgePass({ session, hasToken, health, me, authProbe }) {
  // Explicit: health=200 alone is NEVER success.
  const notes = [];
  let pass = false;
  if (!health || health.status !== 200) {
    notes.push('health_not_200');
  }
  if (session === 'desktop-no-cookie' && hasToken) {
    const body = authProbe && authProbe.body;
    pass = Boolean(
      authProbe &&
        authProbe.status === 200 &&
        body &&
        body.tokenAccepted === true &&
        body.uid &&
        !String(JSON.stringify(body)).includes(String(hasToken).slice(0, 8)),
    );
    if (!pass) notes.push('auth_probe_identity_failed');
    if (body && body.deviceToken) notes.push('token_echoed_FORBIDDEN');
  } else if (session === 'desktop-no-cookie' && !hasToken) {
    pass = Boolean(authProbe && (authProbe.status === 401 || authProbe.status === 403));
    if (!pass) notes.push('expected_auth_probe_401');
  } else if (session === 'web-anonymous') {
    pass = Boolean(me && (me.status === 401 || me.status === 403));
    if (!pass) notes.push('expected_me_401');
  } else if (session === 'web-logged-in') {
    pass = Boolean(me && me.status === 200 && me.body && me.body.uid);
    if (!pass) notes.push('expected_me_200_uid');
  } else {
    notes.push('manual_review_required');
  }
  return { pass, notes, rule: 'identity_isolation_and_authorization_arrival_not_health_alone' };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.baseUrl) {
    console.log(`Usage: node scripts/nas-sync-g0-probe.js --base-url <url> [options]

Options:
  --channel lan|fnconnect|frp
  --session web-logged-in|web-anonymous|desktop-no-cookie|desktop-invalid-token|web-logged-in-cross-uid-token
  --token <deviceToken>          (omit for no-token cells)
  --cookie 'name=value'         (web session cookie if needed)
  --out <dir>                   archive directory (writes redacted JSON)
  --timeout-ms 8000

Success ≠ health=200. See docs/nas-sync-g0-probe-checklist.md
G0 status remains 🔴 until user archives a real NAS run.`);
    process.exit(args.help ? 0 : 2);
  }

  const headers = {};
  if (args.token) headers.Authorization = `Bearer ${args.token}`;
  if (args.cookie) headers.Cookie = args.cookie;

  const health = await fetchJson(joinApi(args.baseUrl, 'api/v1/health'), { timeoutMs: args.timeoutMs });
  const me = await fetchJson(joinApi(args.baseUrl, 'api/v1/me'), {
    headers,
    timeoutMs: args.timeoutMs,
  });
  const authProbe = await fetchJson(joinApi(args.baseUrl, 'api/v1/auth-probe'), {
    headers,
    timeoutMs: args.timeoutMs,
  });

  const expected = expectedMatrixCell({ session: args.session, hasToken: Boolean(args.token) });
  const judgment = judgePass({
    session: args.session,
    hasToken: args.token || '',
    health,
    me,
    authProbe,
  });

  const report = {
    meta: {
      probedAt: new Date().toISOString(),
      channel: args.channel,
      session: args.session,
      baseUrl: args.baseUrl,
      hadToken: Boolean(args.token),
      hadCookie: Boolean(args.cookie),
      g0Claim: 'NOT_CLAIMED — archive for user/agent review only',
    },
    expected,
    judgment,
    results: {
      health: {
        status: health.status || null,
        ok: health.ok === true,
        error: health.error || null,
        certificateError: health.certificateError === true,
        body: health.body,
      },
      me: {
        status: me.status || null,
        ok: me.ok === true,
        error: me.error || null,
        body: me.body,
      },
      authProbe: {
        status: authProbe.status || null,
        ok: authProbe.ok === true,
        error: authProbe.error || null,
        body: authProbe.body,
      },
    },
  };

  const printed = redact(JSON.stringify(report, null, 2));
  console.log(printed);

  if (args.outDir) {
    fs.mkdirSync(args.outDir, { recursive: true });
    const file = path.join(
      args.outDir,
      `probe-${args.channel}-${args.session}-${Date.now()}.json`,
    );
    fs.writeFileSync(file, printed);
    console.error(`archived: ${file}`);
  }

  // Exit 0 even on judgment.pass=false when run as archive helper — G0 is user-gated.
  // Use --strict to fail CI-style once user opts in (not default).
  if (process.argv.includes('--strict') && !judgment.pass) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(redact(String(error && error.stack ? error.stack : error)));
  process.exit(1);
});
