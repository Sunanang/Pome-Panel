'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { pagination } = require('../renderer/task-inbox-domain');
for (const [total, page, expected] of [
  [0, 0, [false, false, false, '']], [3, 0, [false, false, false, '']], [5, 0, [false, false, false, '']],
  [11, 0, [true, false, true, '']], [11, 1, [true, true, true, '第 2 页']], [11, 2, [true, true, false, '第 3 页']],
  [10, 0, [true, false, true, '']], [10, 1, [true, true, false, '第 2 页']],
]) test(`pagination: ${total} records, page ${page + 1}`, () => {
  const result = pagination(total, page, 5);
  assert.deepEqual([result.visible, result.previous, result.next, result.label], expected);
  assert.equal(result.offset, page * 5); assert.equal(result.limit, 5);
});
test('a removed last page clamps to existing data rather than an empty page', () => {
  assert.equal(pagination(5, 2, 5).page, 0);
});
