'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function writeAtomic(filePath, bytes, disk = fs) {
  disk.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = disk.openSync(temporary, 'wx', 0o600);
    disk.writeFileSync(fd, bytes);
    disk.fsyncSync(fd);
    disk.closeSync(fd);
    fd = undefined;
    disk.renameSync(temporary, filePath);
    if (process.platform !== 'win32') { const directory = disk.openSync(path.dirname(filePath), 'r'); try { disk.fsyncSync(directory); } finally { disk.closeSync(directory); } }
  } finally {
    if (fd !== undefined) disk.closeSync(fd);
    if (disk.existsSync(temporary)) disk.unlinkSync(temporary);
  }
}

function writeJsonAtomic(filePath, value, disk = fs) {
  writeAtomic(filePath, `${JSON.stringify(value)}\n`, disk);
}

function readJsonStrict(filePath, fallback, disk = fs) {
  if (!disk.existsSync(filePath)) return fallback;
  try { return JSON.parse(disk.readFileSync(filePath, 'utf8')); }
  catch (error) { throw Object.assign(new Error('存储文件损坏，原文件已保留。'), { code: 'storage_corrupt', cause: error }); }
}

module.exports = { writeAtomic, writeJsonAtomic, readJsonStrict };
