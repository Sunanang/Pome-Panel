'use strict';
const crypto = require('node:crypto');
let opening = null;
function begin() { opening = { id: crypto.randomUUID(), start: process.hrtime.bigint() }; return opening.id; }
function finish(id) { if (!opening || opening.id !== id) throw new Error('open_measurement_mismatch'); return Number(process.hrtime.bigint() - opening.start) / 1e6; }
function current() { return opening?.id || null; }
module.exports = { begin, finish, current };
