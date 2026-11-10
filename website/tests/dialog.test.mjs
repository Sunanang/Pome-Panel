import test from 'node:test';
import assert from 'node:assert/strict';
import { isDialogBackdropEvent } from '../src/dialog.mjs';

const dialog = { getBoundingClientRect: () => ({ left: 100, right: 500, top: 80, bottom: 600 }) };
const event = (x, y, target = dialog) => ({ currentTarget: dialog, target, clientX: x, clientY: y });

test('dialog padding and its border do not count as the backdrop', () => {
  for (const [x, y] of [[103, 300], [300, 83], [100, 80], [500, 600]]) {
    assert.equal(isDialogBackdropEvent(event(x, y)), false);
  }
});

test('all four outside edges count as backdrop clicks', () => {
  for (const [x, y] of [[99, 300], [501, 300], [300, 79], [300, 601]]) {
    assert.equal(isDialogBackdropEvent(event(x, y)), true);
  }
});

test('bubbled content events and events without coordinates cannot dismiss the dialog', () => {
  assert.equal(isDialogBackdropEvent(event(8, 8, {})), false);
  assert.equal(isDialogBackdropEvent(event(undefined, undefined)), false);
});
