'use strict';

/**
 * Offline Chinese almanac day model (lunar-javascript / 6tail).
 * Browser: depends on global Solar from vendor/lunar-javascript/lunar.js.
 * Node tests: require('lunar-javascript').
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const lunar = require('lunar-javascript');
    module.exports = factory(lunar.Solar);
  } else {
    root.NotchAlmanac = factory(root.Solar);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Solar) {
  const WEEKDAYS = Object.freeze(['日', '一', '二', '三', '四', '五', '六']);

  function civilParts(date) {
    const value = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }

  function civilKey(date) {
    const parts = civilParts(date);
    if (!parts) return '';
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  }

  function msUntilNextLocalMidnight(now = new Date()) {
    const base = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(base.getTime())) return 60_000;
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, 0, 0, 0, 0);
    return Math.max(1000, next.getTime() - base.getTime() + 40);
  }

  function takeList(list, count) {
    if (!Array.isArray(list) || count <= 0) return [];
    return list.slice(0, count);
  }

  function joinItems(list, separator = ' ') {
    return takeList(list, list.length).filter(Boolean).join(separator);
  }

  function daysBetweenCivil(fromParts, toParts) {
    const a = Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day);
    const b = Date.UTC(toParts.year, toParts.month - 1, toParts.day);
    return Math.round((b - a) / 86_400_000);
  }

  function buildAlmanacDay(date = new Date()) {
    if (typeof Solar !== 'function' && typeof Solar?.fromYmd !== 'function') {
      throw new Error('lunar-javascript Solar is unavailable');
    }
    const parts = civilParts(date);
    if (!parts) throw new Error('invalid date');
    const solar = Solar.fromYmd(parts.year, parts.month, parts.day);
    const lunar = solar.getLunar();
    const yi = [...(lunar.getDayYi() || [])];
    const ji = [...(lunar.getDayJi() || [])];
    const jieQiToday = String(lunar.getJieQi() || '');
    const nextJieQi = lunar.getNextJieQi(true);
    const nextSolar = nextJieQi?.getSolar?.();
    const nextParts = nextSolar
      ? { year: nextSolar.getYear(), month: nextSolar.getMonth(), day: nextSolar.getDay() }
      : null;
    const daysToNext = nextParts ? daysBetweenCivil(parts, nextParts) : null;
    const chongAnimal = String(lunar.getDayChongDesc() || '').replace(/^\([^)]*\)/, '');
    const sha = String(lunar.getDaySha() || '');
    const xiu = `${lunar.getXiu() || ''}${lunar.getZheng() || ''}${lunar.getAnimal() || ''}`;
    const luckyHours = (lunar.getTimes() || [])
      .filter((time) => time && time.getTianShenLuck && time.getTianShenLuck() === '吉')
      .map((time) => {
        const ganZhi = String(time.getGanZhi() || '');
        return {
          branch: ganZhi.slice(-1),
          ganZhi,
          deity: String(time.getTianShen() || ''),
          startHm: String(time.getMinHm() || ''),
          endHm: String(time.getMaxHm() || ''),
        };
      });

    return {
      key: civilKey(date),
      solar: {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        weekday: WEEKDAYS[solar.getWeek()] || '',
        weekdayLabel: `星期${WEEKDAYS[solar.getWeek()] || ''}`,
      },
      lunar: {
        yearLabel: `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
        monthDay: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
        yearGanZhi: String(lunar.getYearInGanZhi() || ''),
        monthGanZhi: String(lunar.getMonthInGanZhi() || ''),
        dayGanZhi: String(lunar.getDayInGanZhi() || ''),
        ganZhiLine: `${lunar.getYearInGanZhi()}年 ${lunar.getMonthInGanZhi()}月 ${lunar.getDayInGanZhi()}日`,
        shengXiao: String(lunar.getYearShengXiao() || ''),
      },
      jieQi: {
        today: jieQiToday,
        isToday: Boolean(jieQiToday),
        nextName: nextJieQi ? String(nextJieQi.getName() || '') : '',
        nextKey: nextParts
          ? `${nextParts.year}-${String(nextParts.month).padStart(2, '0')}-${String(nextParts.day).padStart(2, '0')}`
          : '',
        daysToNext,
      },
      yi,
      ji,
      chongSha: `冲${chongAnimal} 煞${sha}`.trim(),
      naYin: String(lunar.getDayNaYin() || ''),
      jianChu: String(lunar.getZhiXing() || ''),
      zhiShen: String(lunar.getDayTianShen() || ''),
      xiu,
      jiShen: [...(lunar.getDayJiShen() || [])],
      pengZu: {
        gan: String(lunar.getPengZuGan() || ''),
        zhi: String(lunar.getPengZuZhi() || ''),
        line: [lunar.getPengZuGan(), lunar.getPengZuZhi()].filter(Boolean).join(' '),
      },
      luckyHours,
    };
  }

  const SIZE_LIMITS = Object.freeze({
    mini: { yi: 2, ji: 2 },
    small: { yi: 3, ji: 3 },
    medium: { yi: 8, ji: 6, jiShen: 4 },
    large: { yi: 10, ji: 6, jiShen: 8 },
  });

  function formatForSize(day, size) {
    const limits = SIZE_LIMITS[size] || SIZE_LIMITS.medium;
    const yi = takeList(day.yi, limits.yi);
    const ji = takeList(day.ji, limits.ji);
    const jieQiLabel = day.jieQi.isToday
      ? day.jieQi.today
      : day.jieQi.nextName;
    const jieQiCountdown = day.jieQi.isToday
      ? ''
      : (Number.isInteger(day.jieQi.daysToNext) ? `${day.jieQi.daysToNext}天` : '');
    return {
      size,
      day,
      yi,
      ji,
      yiText: joinItems(yi),
      jiText: joinItems(ji),
      jieQiLabel,
      jieQiCountdown,
      jiShen: takeList(day.jiShen, limits.jiShen || day.jiShen.length),
      luckyHourText: day.luckyHours.map((item) => item.branch).filter(Boolean).join(' '),
    };
  }

  return {
    WEEKDAYS,
    SIZE_LIMITS,
    civilParts,
    civilKey,
    msUntilNextLocalMidnight,
    takeList,
    joinItems,
    buildAlmanacDay,
    formatForSize,
  };
}));
