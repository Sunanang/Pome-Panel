'use strict';
const assert = require('node:assert/strict');
const chinese = require('../../localization/locales/zh-CN.json');
const english = require('../../localization/locales/en-US.json');
function keyFor(text) {
  const entry = Object.entries(chinese).find(([, value]) => value === text);
  assert(entry, `Missing Chinese resource: ${text}`);
  return entry[0];
}
function assertCopy(source, text) {
  const key = keyFor(text);
  assert(source.includes(key), `Copy isn't wired to the resource: ${key}`);
  assert(english[key], `Missing English resource: ${key}`);
}
module.exports = { keyFor, assertCopy };
