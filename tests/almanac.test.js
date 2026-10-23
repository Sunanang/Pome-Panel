'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Almanac = require('../renderer/almanac');

test('2026-10-23 almanac fields match lunar-javascript', () => {
  const day = Almanac.buildAlmanacDay(new Date(2026, 9, 23, 12, 0, 0));
  assert.equal(day.key, '2026-10-23');
  assert.equal(day.solar.day, 23);
  assert.equal(day.solar.weekday, '五');
  assert.equal(day.lunar.monthDay, '九月十四');
  assert.match(day.lunar.yearLabel, /九月十四/);
  assert.equal(day.lunar.yearGanZhi, '丙午');
  assert.equal(day.lunar.monthGanZhi, '戊戌');
  assert.equal(day.lunar.dayGanZhi, '庚午');
  assert.equal(day.lunar.shengXiao, '马');
  assert.equal(day.jieQi.today, '霜降');
  assert.equal(day.jieQi.isToday, true);
  assert.equal(day.jieQi.nextName, '立冬');
  assert.equal(day.jianChu, '成');
  assert.equal(day.zhiShen, '天刑');
  assert.equal(day.naYin, '路旁土');
  assert.match(day.chongSha, /冲鼠/);
  assert.match(day.chongSha, /煞北/);
  assert.equal(day.xiu, '牛金牛');
  assert.ok(day.yi.includes('嫁娶'));
  assert.ok(day.yi.includes('开市'));
  assert.deepEqual(day.yi.slice(0, 2), ['嫁娶', '纳采']);
  assert.deepEqual(day.ji.slice(0, 2), ['探病', '纳畜']);
  assert.ok(day.jiShen.length > 0);
  assert.ok(day.pengZu.line.includes('庚'));
  assert.ok(day.luckyHours.some((item) => item.branch === '子'));
});

test('size formatters truncate yi/ji without ellipsis padding', () => {
  const day = Almanac.buildAlmanacDay(new Date(2026, 9, 23, 8, 0, 0));
  const mini = Almanac.formatForSize(day, 'mini');
  const small = Almanac.formatForSize(day, 'small');
  const medium = Almanac.formatForSize(day, 'medium');
  const large = Almanac.formatForSize(day, 'large');
  assert.deepEqual(mini.yi, day.yi.slice(0, 2));
  assert.deepEqual(mini.ji, day.ji.slice(0, 2));
  assert.equal(mini.yiText.includes('…'), false);
  assert.deepEqual(small.yi, day.yi.slice(0, 3));
  assert.deepEqual(small.ji, day.ji.slice(0, 3));
  assert.equal(medium.yi.length, 8);
  assert.equal(medium.ji.length, 6);
  assert.equal(large.yi.length, 10);
  assert.equal(large.ji.length, 6);
  assert.equal(medium.jieQiLabel, '霜降');
  assert.equal(medium.jieQiCountdown, '');
});

test('non-jieqi day shows next term countdown', () => {
  const day = Almanac.buildAlmanacDay(new Date(2026, 9, 24, 9, 0, 0));
  assert.equal(day.jieQi.isToday, false);
  assert.equal(day.jieQi.today, '');
  assert.equal(day.jieQi.nextName, '立冬');
  assert.equal(day.jieQi.daysToNext, 14);
  const view = Almanac.formatForSize(day, 'medium');
  assert.equal(view.jieQiLabel, '立冬');
  assert.equal(view.jieQiCountdown, '14天');
});

test('midnight scheduler waits until the next local day', () => {
  const wait = Almanac.msUntilNextLocalMidnight(new Date(2026, 9, 23, 23, 59, 30, 0));
  assert.ok(wait > 500 && wait < 60_000);
});
