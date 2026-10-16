'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { codexHomes } = require('./codex-usage');

// Read only native metadata for this exact thread. Do not infer session names
// from project names or assistant summaries. Index reads and SQLite waits are bounded.
function readCodexThreadTitle(threadId, { homes = codexHomes() } = {}) {
  if (typeof threadId !== 'string' || !threadId || threadId.length > 160) return '';
  for (const home of homes) {
    let fd;
    try {
      fd = fs.openSync(path.join(home, 'session_index.jsonl'), 'r');
      const stat = fs.fstatSync(fd);
      if (stat.isFile()) {
        const length = Math.min(stat.size, 1024 * 1024), buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, stat.size - length);
        const lines = buffer.toString('utf8').split('\n');
        if (stat.size > length) lines.shift();
        for (const line of lines.reverse()) {
          let row; try { row = JSON.parse(line); } catch { continue; }
          if (row.id === threadId && typeof row.thread_name === 'string' && row.thread_name.trim()) return row.thread_name.trim().slice(0, 256);
        }
      }
    } catch {} finally { if (fd !== undefined) fs.closeSync(fd); }
    let db;
    try {
      const files = fs.readdirSync(home).filter(file => /^state_\d+\.sqlite$/.test(file))
        .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
      if (!files.length) continue;
      db = new DatabaseSync(path.join(home, files[0]), { readOnly: true });
      db.exec('PRAGMA busy_timeout=100');
      const row = db.prepare('SELECT substr(title, 1, 256) AS title FROM threads WHERE id = ? LIMIT 1').get(threadId);
      if (typeof row?.title === 'string' && row.title.trim()) return row.title.trim();
    } catch {} finally { try { db?.close(); } catch {} }
  }
  return '';
}
module.exports = { readCodexThreadTitle };
