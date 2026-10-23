'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
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

test('early and late Zi keep distinct clock intervals even when both are lucky', () => {
  const day = Almanac.buildAlmanacDay(new Date(2026, 0, 4, 12));
  const hours = day.luckyHours.filter(hour => hour.branch === '子');
  assert.deepEqual(hours.map(({ label, startHm, endHm }) => ({ label, startHm, endHm })), [
    { label: '早子', startHm: '00:00', endHm: '00:59' },
    { label: '晚子', startHm: '23:00', endHm: '23:59' },
  ]);
  assert.notEqual(hours[0].ganZhi, hours[1].ganZhi);
  const text = Almanac.formatForSize(day, 'large').luckyHourText;
  assert.match(text, /早子 00:00–00:59/);
  assert.match(text, /晚子 23:00–23:59/);
  const lateOnly = Almanac.buildAlmanacDay(new Date(2026, 9, 24, 12)).luckyHours.filter(hour => hour.branch === '子');
  assert.deepEqual(lateOnly.map(hour => hour.label), ['晚子']);
});

test('solar-term time is rounded to a minute and stays in UTC+8 across host timezones', () => {
  const script = `const A=require('./renderer/almanac');const d=A.buildAlmanacDay(new Date(2026,9,23,12));console.log(JSON.stringify({time:d.jieQi.todayTiming,view:A.formatForSize(d,'large').jieQiTimeText}));`;
  for (const zone of ['Asia/Shanghai', 'America/New_York', 'Pacific/Auckland']) {
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, TZ: zone }, encoding: 'utf8' }));
    assert.deepEqual(result.time, { key: '2026-10-23', hm: '17:38', dateTime: '2026-10-23T17:38:00+08:00' });
    assert.equal(result.view, '约17:38');
  }
});

test('upcoming solar term carries its own date and time through a year boundary', () => {
  const day = Almanac.buildAlmanacDay(new Date(2026, 11, 31, 12));
  assert.equal(day.jieQi.nextName, '小寒');
  assert.equal(day.jieQi.nextKey, '2027-01-05');
  assert.equal(day.jieQi.nextTiming.key, day.jieQi.nextKey);
  const view = Almanac.formatForSize(day, 'medium');
  assert.match(view.jieQiTimeText, /^1\/5 约\d{2}:\d{2}$/);
  assert.equal(view.jieQiCountdown, '5天');
  assert.equal(view.jieQiTiming.dateTime.endsWith('+08:00'), true);
});
