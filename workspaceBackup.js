'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const yauzl = require('yauzl');
const { writeJsonAtomic, readJsonStrict } = require('./atomicStorage');
const { portableMediaPath } = require('./platform');

const DEFAULTS = Object.freeze({
  'notch-todo-data': JSON.stringify({ P0: [], P1: [], P2: [], P3: [] }),
  'notch-todo-category-names-v1': '{}', 'notch-home-note': '',
  'notch-note-archive-v1': '[]', 'notch-note-active-archive-v1': '',
  'notch-link-groups': '[]', 'notch-home-commands': '[]',
  'notch-clip-history': '[]', 'notch-clip-favorites': '[]', 'notch-recordings': '[]',
});
const BACKUP_KEYS = Object.freeze(Object.keys(DEFAULTS));
const EXCLUSIONS = Object.freeze(['secrets', 'aiCredentials', 'deviceTokens', 'pairing', 'tlsTrust', 'syncCursor', 'syncQueue', 'homeLayout', 'systemSettings', 'taskInbox']);
const MAX_DATA_BYTES = 32 * 1024 * 1024;
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code });

function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')
    || value.startsWith('/') || /^[A-Za-z]:/.test(value)
    || value.split('/').some((s) => !s || s === '.' || s === '..' || s.includes(':'))) {
    throw fail('invalid_path', `备份路径不安全：${String(value).slice(0, 120)}`);
  }
  return value;
}

function normalizeStorage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('invalid_storage', '工作区资料格式不正确。');
  const storage = { ...DEFAULTS };
  for (const key of BACKUP_KEYS) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string') throw fail('invalid_storage', `资料格式不正确：${key}`);
      storage[key] = input[key];
    }
  }
  const arrays = BACKUP_KEYS.filter((k) => k !== 'notch-todo-data' && k !== 'notch-todo-category-names-v1'
    && k !== 'notch-home-note' && k !== 'notch-note-active-archive-v1');
  for (const key of arrays) {
    let rows;
    try { rows = JSON.parse(storage[key]); } catch { throw fail('invalid_storage', `资料无法读取：${key}`); }
    if (!Array.isArray(rows)) throw fail('invalid_storage', `资料不是列表：${key}`);
    if (key !== 'notch-clip-favorites') {
      const ids = new Set();
      for (const row of rows) {
        if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || ids.has(row.id)) {
          throw fail('invalid_storage', `资料包含无效或重复 ID：${key}`);
        }
        ids.add(row.id);
      }
    }
    if (key === 'notch-recordings' || key === 'notch-clip-history') {
      const field = key === 'notch-recordings' ? 'audioPath' : 'imagePath';
      const dir = key === 'notch-recordings' ? 'recordings' : 'clipboard-images';
      storage[key] = JSON.stringify(rows.map((r) => r[field] ? { ...r, [field]: safeRelative(portableMediaPath(dir, r[field])) } : r));
    }
  }
  let todos, categories;
  try { todos = JSON.parse(storage['notch-todo-data']); categories = JSON.parse(storage['notch-todo-category-names-v1']); }
  catch { throw fail('invalid_storage', '待办或分类无法读取。'); }
  if (!todos || typeof todos !== 'object' || ['P0', 'P1', 'P2', 'P3'].some((k) => !Array.isArray(todos[k]))) {
    throw fail('invalid_storage', '待办 P0–P3 结构不正确。');
  }
  const todoIds = new Set();
  for (const priority of ['P0', 'P1', 'P2', 'P3']) for (const row of todos[priority]) {
    if (!row || typeof row.id !== 'string' || !row.id || todoIds.has(row.id) || typeof row.text !== 'string') throw fail('invalid_storage', '待办包含无效内容或重复 ID。');
    todoIds.add(row.id);
  }
  if (!categories || typeof categories !== 'object' || Array.isArray(categories)) throw fail('invalid_storage', '分类名称结构不正确。');
  if (Object.values(categories).some((name) => typeof name !== 'string')) throw fail('invalid_storage', '分类名称必须是文本。');
  return storage;
}

function collectionCounts(storage) {
  const todos = JSON.parse(storage['notch-todo-data']);
  const groups = JSON.parse(storage['notch-link-groups']);
  return {
    todos: Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map((k) => [k, todos[k].length])),
    categoryNames: Object.keys(JSON.parse(storage['notch-todo-category-names-v1'])).length,
    notes: { archive: JSON.parse(storage['notch-note-archive-v1']).length, homeIncluded: true },
    links: { groups: groups.length, items: groups.reduce((n, g) => n + (Array.isArray(g.links) ? g.links.length : 0), 0) },
    commands: JSON.parse(storage['notch-home-commands']).length,
    clipboard: { history: JSON.parse(storage['notch-clip-history']).length, favorites: JSON.parse(storage['notch-clip-favorites']).length },
    recordings: JSON.parse(storage['notch-recordings']).length,
  };
}

function mediaReferences(storage) {
  const paths = new Set();
  for (const [key, field, dir] of [['notch-recordings', 'audioPath', 'recordings'], ['notch-clip-history', 'imagePath', 'clipboard-images']]) {
    for (const row of JSON.parse(storage[key])) {
      if (!row[field]) continue;
      const relative = safeRelative(row[field]);
      if (!relative.startsWith(`${dir}/`)) throw fail('invalid_path', '媒体路径与集合不匹配。');
      paths.add(relative);
    }
  }
  return [...paths].sort();
}

async function copyHashed(source, destination, maxBytes = Infinity) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  await pipeline(source, new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > maxBytes) return callback(fail('file_too_large', '备份文件超过支持的大小。'));
    hash.update(chunk); callback(null, chunk);
  } }), fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  return { bytes, sha256: hash.digest('hex') };
}

function assertLocalMedia(root, relative) {
  const resolvedRoot = fs.realpathSync(root);
  let target = resolvedRoot;
  for (const segment of safeRelative(relative).split('/')) {
    target = path.join(target, segment);
    let stat;
    try { stat = fs.lstatSync(target); } catch { throw fail('media_missing', `媒体文件缺失：${relative}`); }
    if (stat.isSymbolicLink()) throw fail('invalid_path', `媒体路径不能是链接：${relative}`);
  }
  if (!fs.statSync(target).isFile()) throw fail('media_missing', `媒体不是文件：${relative}`);
  return target;
}

async function exportWorkspaceBackup({ root, storage, destination, appVersion }) {
  storage = normalizeStorage(storage);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-backup-export-'));
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  try {
    const data = Buffer.from(`${JSON.stringify({ version: 1, localStorage: storage })}\n`);
    if (data.length > MAX_DATA_BYTES) throw fail('data_too_large', '工作区索引超过备份支持的大小。');
    fs.mkdirSync(path.join(stage, 'data'));
    fs.writeFileSync(path.join(stage, 'data/workspace.json'), data, { mode: 0o600 });
    const files = [{ path: 'data/workspace.json', bytes: data.length, sha256: sha(data) }];
    for (const relative of mediaReferences(storage)) {
      const source = assertLocalMedia(root, relative);
      const before = fs.statSync(source);
      const digest = await copyHashed(fs.createReadStream(source), path.join(stage, 'media', relative));
      const after = fs.statSync(source);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
        throw fail('media_changed', `导出期间媒体发生变化：${relative}`);
      }
      files.push({ path: `media/${relative}`, ...digest });
    }
    const manifest = { format: 'pome-workspace-backup', formatVersion: 1, appVersion: String(appVersion || ''),
      createdAt: Date.now(), backupId: crypto.randomUUID(), collections: collectionCounts(storage), files,
      exclusions: EXCLUSIONS, includedKeys: BACKUP_KEYS };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
    const zip = new yazl.ZipFile();
    const writing = pipeline(zip.outputStream, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    zip.on('error', (error) => zip.outputStream.destroy(error));
    zip.addBuffer(manifestBytes, 'manifest.json');
    zip.addBuffer(Buffer.from(sha(manifestBytes)), 'manifest.sha256');
    for (const file of files) zip.addFile(path.join(stage, file.path), file.path);
    zip.end();
    await writing;
    const fd = fs.openSync(temporary, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const checked = await inspectWorkspaceBackup(temporary);
    checked.dispose();
    fs.renameSync(temporary, destination);
    if (process.platform !== 'win32') { const dir = fs.openSync(path.dirname(destination), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
    return { manifest, path: destination };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(temporary, { force: true });
  }
}

async function extractArchive(filePath, stage) {
  const zip = await new Promise((resolve, reject) => yauzl.open(filePath,
    { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (e, value) => e ? reject(e) : resolve(value)));
  const files = new Map();
  await new Promise((resolve, reject) => {
    let ended = false;
    function abort(error) { if (ended) return; ended = true; zip.close(); reject(error); }
    zip.on('error', abort);
    zip.on('end', () => { if (!ended) { ended = true; resolve(); } });
    zip.on('entry', (entry) => {
      (async () => {
        const relative = safeRelative(entry.fileName);
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode && mode !== 0o100000) throw fail('invalid_path', '备份只能包含普通文件。');
        if (files.has(relative.toLocaleLowerCase()) || files.size >= 100000) throw fail('invalid_path', '备份包含重复路径或文件过多。');
        if (!['manifest.json', 'manifest.sha256', 'data/workspace.json'].includes(relative)
          && !/^media\/(recordings|clipboard-images)\//.test(relative)) throw fail('invalid_path', `未知备份文件：${relative}`);
        const stream = await new Promise((r, j) => zip.openReadStream(entry, (e, s) => e ? j(e) : r(s)));
        const digest = await copyHashed(stream, path.join(stage, relative), relative.startsWith('media/') ? Infinity : MAX_DATA_BYTES);
        files.set(relative.toLocaleLowerCase(), { path: relative, ...digest });
      })().then(() => { if (!ended) zip.readEntry(); }, abort);
    });
    zip.readEntry();
  });
  return files;
}

async function inspectWorkspaceBackup(filePath) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-backup-read-'));
  const dispose = () => fs.rmSync(stage, { recursive: true, force: true });
  try {
    const files = await extractArchive(filePath, stage);
    const manifestBytes = fs.readFileSync(path.join(stage, 'manifest.json'));
    if (fs.readFileSync(path.join(stage, 'manifest.sha256'), 'utf8').trim() !== sha(manifestBytes)) throw fail('checksum_mismatch', '备份清单校验失败。');
    const manifest = JSON.parse(manifestBytes);
    if (manifest.format !== 'pome-workspace-backup' || manifest.formatVersion !== 1) throw fail('unsupported_version', '不支持此备份格式版本。');
    if (!Array.isArray(manifest.files) || manifest.files.length + 2 !== files.size) throw fail('checksum_mismatch', '备份文件清单数量不一致。');
    const seen = new Set();
    for (const entry of manifest.files) {
      const relative = safeRelative(entry.path);
      if (seen.has(relative.toLocaleLowerCase()) || relative === 'manifest.json' || relative === 'manifest.sha256') throw fail('invalid_path', '备份清单包含重复路径。');
      seen.add(relative.toLocaleLowerCase());
      const actual = files.get(relative.toLocaleLowerCase());
      if (!actual || actual.path !== relative || actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes) throw fail('checksum_mismatch', `文件校验失败：${relative}`);
    }
    const payload = JSON.parse(fs.readFileSync(path.join(stage, 'data/workspace.json'), 'utf8'));
    if (payload.version !== 1) throw fail('unsupported_version', '不支持此资料版本。');
    if (!payload.localStorage || BACKUP_KEYS.some((key) => typeof payload.localStorage[key] !== 'string') || Object.keys(payload.localStorage).some((key) => !BACKUP_KEYS.includes(key))) throw fail('invalid_storage', '备份资料集合不完整或包含未知集合。');
    const storage = normalizeStorage(payload.localStorage);
    if (JSON.stringify(collectionCounts(storage)) !== JSON.stringify(manifest.collections)) throw fail('count_mismatch', '备份集合条数校验失败。');
    const refs = mediaReferences(storage);
    if (manifest.files.length !== refs.length + 1 || refs.some((r) => !seen.has(`media/${r}`.toLocaleLowerCase()))) throw fail('media_missing', '媒体引用与备份文件不一致。');
    return { manifest, storage, stage, dispose };
  } catch (error) { dispose(); throw error; }
}

const RESTORE_PARTS = ['workspace.json', 'recordings', 'clipboard-images'];
function recoverWorkspaceRestore(root, forceRollback = false) {
  const area = path.join(root, '.pome-restore');
  const journalPath = path.join(area, 'journal.json');
  if (!fs.existsSync(journalPath)) { fs.rmSync(area, { recursive: true, force: true }); return false; }
  const journal = readJsonStrict(journalPath);
  if (journal.version !== 1 || !Array.isArray(journal.existed) || journal.existed.length !== 3) throw fail('restore_journal_invalid', '恢复日志损坏，禁止继续写入。');
  if (forceRollback || journal.phase !== 'committed') {
    RESTORE_PARTS.forEach((part, index) => {
      const target = path.join(root, part), previous = path.join(area, 'previous', part);
      if (fs.existsSync(previous)) {
        fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(previous, target);
      } else if (!journal.existed[index]) fs.rmSync(target, { recursive: true, force: true });
    });
  }
  fs.rmSync(area, { recursive: true, force: true });
  return true;
}

// Journal and staging live on the workspace volume. A crash during any rename
// rolls back on startup; only a durable committed marker permits cleanup.
function applyWorkspaceRestore({ root, inspected, currentStorage, afterRename = () => {} }) {
  recoverWorkspaceRestore(root);
  const area = path.join(root, '.pome-restore');
  fs.mkdirSync(path.join(area, 'incoming'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(area, 'previous'), { recursive: true, mode: 0o700 });
  const storage = { ...currentStorage, ...inspected.storage };
  const incoming = path.join(area, 'incoming');
  writeJsonAtomic(path.join(incoming, 'workspace.json'), { version: 1, updatedAt: Date.now(), localStorage: storage });
  for (const folder of RESTORE_PARTS.slice(1)) {
    fs.mkdirSync(path.join(incoming, folder), { recursive: true });
    const source = path.join(inspected.stage, 'media', folder);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(incoming, folder), { recursive: true });
  }
  for (const relative of mediaReferences(inspected.storage)) { const fd = fs.openSync(path.join(incoming, relative), 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  const journal = { version: 1, phase: 'applying', existed: RESTORE_PARTS.map((part) => fs.existsSync(path.join(root, part))) };
  writeJsonAtomic(path.join(area, 'journal.json'), journal);
  try {
    RESTORE_PARTS.forEach((part, index) => {
      const target = path.join(root, part);
      if (journal.existed[index]) fs.renameSync(target, path.join(area, 'previous', part));
      fs.renameSync(path.join(incoming, part), target);
      afterRename(index);
    });
    writeJsonAtomic(path.join(area, 'journal.json'), { ...journal, phase: 'committed' });
  } catch (error) { recoverWorkspaceRestore(root, true); throw error; }
  fs.rmSync(area, { recursive: true, force: true });
  return storage;
}

module.exports = { BACKUP_KEYS, EXCLUSIONS, normalizeStorage, collectionCounts, mediaReferences,
  exportWorkspaceBackup, inspectWorkspaceBackup, safeRelative, assertLocalMedia, sha,
  applyWorkspaceRestore, recoverWorkspaceRestore };
