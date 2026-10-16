'use strict';

// Read session telemetry only. Credentials and network APIs are deliberately absent.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const CHUNK_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;

function codexHomes({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const candidates = [env.CODEX_HOME || path.join(home, '.codex')];
  if (platform === 'win32') candidates.push(path.join(env.USERPROFILE || home, '.codex'));
  return [...new Set(candidates.map((item) => path.resolve(item)))];
}

function finite(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseUsageLine(line) {
  let record;
  try { record = JSON.parse(line); } catch { return null; }
  const limits = record?.payload?.rate_limits;
  const timestamp = Date.parse(record?.timestamp);
  if (record?.type !== 'event_msg' || record.payload?.type !== 'token_count'
    || !limits || typeof limits !== 'object' || Array.isArray(limits) || !Number.isFinite(timestamp)) return null;
  function windowUsage(window) {
    if (!window || typeof window !== 'object') return null;
    const percent = finite(window.used_percent);
    if (percent == null) return null;
    const absolute = finite(window.resets_at);
    const relative = finite(window.resets_in_seconds);
    const reset = absolute ?? (relative == null ? null : timestamp / 1000 + relative);
    return {
      percent: Math.max(0, Math.min(100, percent)),
      windowMinutes: finite(window.window_minutes),
      resetsAt: reset,
    };
  }
  const primary = windowUsage(limits.primary);
  const secondary = windowUsage(limits.secondary);
  const credits = limits.credits && typeof limits.credits === 'object' ? {
    hasCredits: limits.credits.has_credits === true,
    unlimited: limits.credits.unlimited === true,
    balance: finite(limits.credits.balance),
  } : null;
  return { ok: true, detected: true, updatedAt: new Date(timestamp).toISOString(), primary, secondary,
    plan: typeof limits.plan_type === 'string' ? limits.plan_type.slice(0, 80) : null, credits };
}

function withExpiry(snapshot, now = Date.now()) {
  const result = { ...snapshot };
  for (const key of ['primary', 'secondary']) {
    result[key] = snapshot[key] ? { ...snapshot[key], expired: snapshot[key].resetsAt != null
      && snapshot[key].resetsAt * 1000 <= now } : null;
  }
  if (Array.isArray(snapshot.windows)) result.windows = snapshot.windows.map(window => ({ ...window, expired: window.resetsAt != null && window.resetsAt * 1000 <= now }));
  return result;
}

async function readLatestUsage(file, { chunkBytes = CHUNK_BYTES } = {}) {
  const handle = await fs.open(file, 'r');
  try {
    let position = (await handle.stat()).size;
    let tail = Buffer.alloc(0);
    let skipping = false;
    while (position > 0) {
      const length = Math.min(chunkBytes, position);
      position -= length;
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      const chunk = buffer.subarray(0, bytesRead);
      let end = chunk.length;
      for (let i = chunk.length - 1; i >= 0; i--) {
        if (chunk[i] !== 10) continue;
        const part = chunk.subarray(i + 1, end);
        if (!skipping && part.length + tail.length <= MAX_LINE_BYTES) {
          const parsed = parseUsageLine(Buffer.concat([part, tail]).toString('utf8'));
          if (parsed) return parsed;
        }
        tail = Buffer.alloc(0);
        skipping = false;
        end = i;
      }
      if (!skipping) {
        if (end + tail.length > MAX_LINE_BYTES) { skipping = true; tail = Buffer.alloc(0); }
        else tail = Buffer.concat([chunk.subarray(0, end), tail]);
      }
    }
    return skipping ? null : parseUsageLine(tail.toString('utf8'));
  } finally { await handle.close(); }
}

async function sessionFiles(homes) {
  const files = [];
  let failed = false;
  async function directories(root, pattern) {
    try { return (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name)).map((entry) => entry.name); }
    catch (error) { if (error.code !== 'ENOENT') failed = true; return []; }
  }
  for (const home of homes) {
    const root = path.join(home, 'sessions');
    for (const year of await directories(root, /^\d{4}$/)) {
      for (const month of await directories(path.join(root, year), /^\d{2}$/)) {
        for (const day of await directories(path.join(root, year, month), /^\d{2}$/)) {
          const dir = path.join(root, year, month, day);
          try {
            for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
              if (!entry.isFile() || !/^rollout-.*\.jsonl$/.test(entry.name)) continue;
              const file = path.join(dir, entry.name);
              // Session filenames encode creation time; mtime reflects recent usage in resumed sessions.
              const stat = await fs.stat(file);
              files.push({ file, mtime: stat.mtimeMs });
            }
          } catch (error) { if (error.code !== 'ENOENT') failed = true; }
        }
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime || b.file.localeCompare(a.file));
  return { files, failed };
}

async function readCodexUsage({ homes = codexHomes(), configured = false, now = Date.now() } = {}) {
  const { files, failed } = await sessionFiles(homes);
  let readFailed = failed;
  for (const { file } of files) {
    try {
      const snapshot = await readLatestUsage(file);
      if (snapshot) return { ...withExpiry(snapshot, now), configured };
    } catch { readFailed = true; }
  }
  return { ok: !readFailed, detected: files.length > 0 || readFailed, configured, updatedAt: null,
    primary: null, secondary: null, error: readFailed ? 'codex_read_failed' : null };
}

module.exports = { codexHomes, parseUsageLine, withExpiry, readLatestUsage, readCodexUsage };
