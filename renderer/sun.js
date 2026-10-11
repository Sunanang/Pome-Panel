(function exposeNotchSun(root, factory) {
  const SunCalc = typeof module === 'object' && module.exports
    ? require('./vendor/suncalc/suncalc.js')
    : root.SunCalc;
  const api = factory(SunCalc);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root.document === 'object') root.NotchSun = api;
})(typeof window !== 'undefined' ? window : globalThis, function createNotchSun(SunCalc) {
  const EVENT_ORDER = ['dawn', 'sunrise', 'goldenHourEnd', 'goldenHour', 'sunset', 'dusk'];
  const EVENT_META = {
    dawn: { name: '天亮', lead: '天亮', note: '民用晨光开始', dot: 'blue' },
    sunrise: { name: '日出', lead: '日出', note: '', dot: 'gold' },
    goldenHourEnd: { name: '黄金时刻结束', lead: '上午黄金时刻结束', note: '上午', dot: 'day' },
    goldenHour: { name: '黄金时刻开始', lead: '下午黄金时刻', note: '下午', dot: 'gold' },
    sunset: { name: '日落', lead: '日落', note: '', dot: 'gold' },
    dusk: { name: '天黑', lead: '天黑', note: '民用暮光结束', dot: 'blue' },
  };
  const ARC = {
    mini: { w: 169, h: 26, hy: 19, kUp: 16 / 53, clamp: 20, markerR: 3, sw: 1.6, dots: 0, drop: false, labels: false },
    small: { w: 165, h: 66, hy: 52, kUp: 44 / 53, clamp: 16, markerR: 3.6, sw: 1.8, dots: 1.8, drop: false, labels: false },
    medium: { w: 361, h: 100, hy: 76, kUp: 62 / 53, clamp: 18, markerR: 4.2, sw: 2.2, dots: 2.3, drop: true, labels: false },
    large: { w: 357, h: 176, hy: 128, kUp: 98 / 53, clamp: 20, markerR: 5, sw: 2.4, dots: 2.6, drop: true, labels: true },
  };
  // Design B：弧线旁当前时间标签字号（mini 不走弧线，改底部一行）
  const NOW_FS = { mini: 11.5, small: 11.5, medium: 12.5, large: 13 };
  const TZ_SUGGESTIONS = {
    'Asia/Shanghai': { name: '上海', admin: '中国' },
    'Asia/Urumqi': { name: '乌鲁木齐', admin: '新疆' },
    'Asia/Hong_Kong': { name: '香港', admin: '中国' },
    'Asia/Macau': { name: '澳门', admin: '中国' },
    'Asia/Taipei': { name: '台北', admin: '台湾' },
    'Asia/Tokyo': { name: '东京' },
    'Asia/Seoul': { name: '首尔' },
    'Europe/London': { name: '伦敦' },
    'Europe/Paris': { name: '巴黎' },
    'America/New_York': { name: '纽约' },
    'America/Los_Angeles': { name: '洛杉矶' },
    'America/Chicago': { name: '芝加哥' },
    'Australia/Sydney': { name: '悉尼' },
  };

  function civilParts(date, timeZone) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const bag = {};
    fmt.formatToParts(date).forEach((part) => {
      if (part.type !== 'literal') bag[part.type] = part.value;
    });
    let hour = Number(bag.hour);
    let day = Number(bag.day);
    if (hour === 24) hour = 0;
    return {
      year: Number(bag.year),
      month: Number(bag.month),
      day,
      hour,
      minute: Number(bag.minute),
      second: Number(bag.second),
    };
  }

  function offsetMinutes(date, timeZone) {
    const parts = civilParts(date, timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return Math.round((asUtc - date.getTime()) / 60000);
  }

  function zonedTime(year, month, day, hour, minute, second, timeZone) {
    const guess = Date.UTC(year, month - 1, day, hour, minute, second || 0);
    const first = offsetMinutes(new Date(guess), timeZone);
    let instant = new Date(guess - first * 60000);
    const secondOffset = offsetMinutes(instant, timeZone);
    if (secondOffset !== first) instant = new Date(guess - secondOffset * 60000);
    return instant;
  }

  function civilNoon(date, timeZone) {
    const parts = civilParts(date, timeZone);
    return zonedTime(parts.year, parts.month, parts.day, 12, 0, 0, timeZone);
  }

  function shiftCivilNoon(date, timeZone, days) {
    const parts = civilParts(date, timeZone);
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
    return zonedTime(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), 12, 0, 0, timeZone);
  }

  function dateAtMinute(noon, timeZone, minute) {
    const parts = civilParts(noon, timeZone);
    const midnight = zonedTime(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
    return new Date(midnight.getTime() + minute * 60000);
  }

  function floorMinute(date) {
    return new Date(Math.floor(date.getTime() / 60000) * 60000);
  }

  function roundMinute(date) {
    return new Date(Math.round(date.getTime() / 60000) * 60000);
  }

  function formatHM(date, timeZone) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '--:--';
    const parts = civilParts(roundMinute(date), timeZone);
    return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  }

  function formatNowHM(date, timeZone) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '--:--';
    const parts = civilParts(date, timeZone);
    return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  }

  // mini 底栏内容区宽度（190px 卡片 − 左右 10px padding）
  const MINI_FOOT_INNER_WIDTH = 170;

  // 粗算 mini 底栏三段时间总宽，用于单测校验不溢出。
  function estimateMiniFootWidth(input) {
    const riseHm = String((input && input.riseHm) || '05:53');
    const nowHm = String((input && input.nowHm) || '13:23');
    const setHm = String((input && input.setHm) || '17:30');
    const labelFs = 10;
    const edgeFs = 10.5;
    const nowFs = 11.5;
    const innerGap = 2;
    const segmentGap = 2;
    const digitW = (fs, text) => fs * 0.62 * text.length;
    const labelW = (text) => labelFs * text.length;
    const edge = (label, hm) => labelW(label) + innerGap + digitW(edgeFs, hm);
    return edge('日出', riseHm) + segmentGap + digitW(nowFs, nowHm) + segmentGap + edge('日落', setHm);
  }

  function miniFootFitsCard(input, innerWidth) {
    const limit = Number.isFinite(innerWidth) ? innerWidth : MINI_FOOT_INNER_WIDTH;
    return estimateMiniFootWidth(input) <= limit;
  }

  // Design B：当前时间标签挂在太阳下降侧；碰边翻侧；夜间贴空心标记旁。
  function placeNowLabel(input) {
    const size = input && input.size;
    const skySide = input && input.skySide;
    const nx = Number(input && input.nx);
    const ny = Number(input && input.ny);
    const up = !!(input && input.up);
    const markerR = Number(input && input.markerR);
    const width = Number(input && input.width);
    const fs = NOW_FS[size] || NOW_FS.medium;
    const r = Number.isFinite(markerR) ? markerR : 4;
    const w = Number.isFinite(width) ? width : 0;
    const x = Number.isFinite(nx) ? nx : 0;
    const y0 = Number.isFinite(ny) ? ny : 0;
    const tw = fs * 0.62 * 5;
    const gap = r + 4;
    // 上午（east / 上升）标签在左，下午（west / 下降）在右，不压弧线
    let left = skySide === 'east';
    if (left && x - gap - tw < -2) left = false;
    if (!left && x + gap + tw > w + 2) left = true;
    // small 正午前后标签偏高，容易压到倒计时「分」——必要时翻到右侧
    if (size === 'small' && up && y0 < 28 && left) left = false;
    const beside = !up;
    return {
      x: left ? x - gap : x + gap,
      y: beside ? y0 - 1 : y0 - r - 3,
      left,
      anchor: left ? 'end' : 'start',
      fontSize: fs,
      night: !up,
    };
  }

  function minuteOfDay(date, timeZone, round) {
    const basis = round ? roundMinute(date) : date;
    const parts = civilParts(basis, timeZone);
    return parts.hour * 60 + parts.minute;
  }

  function durationParts(minutes) {
    const whole = Math.max(0, Math.round(Number(minutes) || 0));
    if (whole < 60) return [{ n: whole, u: '分钟' }];
    const hours = Math.floor(whole / 60);
    const rest = whole % 60;
    return rest ? [{ n: hours, u: '小时' }, { n: rest, u: '分' }] : [{ n: hours, u: '小时' }];
  }

  function durationText(minutes) {
    return durationParts(minutes).map((part) => `${part.n} ${part.u}`).join(' ');
  }

  function formatSignedDelta(seconds) {
    if (!Number.isFinite(seconds)) return null;
    const sign = seconds < 0 ? '−' : seconds > 0 ? '+' : '';
    const abs = Math.abs(Math.round(seconds));
    const minutes = Math.floor(abs / 60);
    const rest = abs % 60;
    if (minutes && rest) return { sign, minutes, seconds: rest };
    if (minutes) return { sign, minutes, seconds: 0 };
    return { sign, minutes: 0, seconds: rest };
  }

  function phaseAt(nowMin, marks, flags) {
    if (flags && flags.alwaysUp) return 'day';
    if (flags && flags.alwaysDown) return 'night';
    const dawn = marks.dawn;
    const sunrise = marks.sunrise;
    const goldenHourEnd = marks.goldenHourEnd;
    const goldenHour = marks.goldenHour;
    const sunset = marks.sunset;
    const dusk = marks.dusk;
    if (dawn == null && dusk == null) return 'day';
    if ((dawn != null && nowMin < dawn) || (dusk != null && nowMin >= dusk)) return 'night';
    if ((dawn != null && sunrise != null && nowMin >= dawn && nowMin < sunrise)
      || (sunset != null && dusk != null && nowMin >= sunset && nowMin < dusk)) return 'blue';
    if ((sunrise != null && goldenHourEnd != null && nowMin >= sunrise && nowMin < goldenHourEnd)
      || (goldenHour != null && sunset != null && nowMin >= goldenHour && nowMin < sunset)) return 'golden';
    return 'day';
  }

  function skyAsset(size, phase) {
    const tall = size === 'small' || size === 'large';
    return `assets/sun-sky-${phase}${tall ? '-tall' : ''}.webp`;
  }

  function readTimes(noon, lat, lng) {
    const times = SunCalc.getTimes(noon, lat, lng);
    return {
      dawn: times.dawn,
      sunrise: times.sunrise,
      goldenHourEnd: times.goldenHourEnd,
      goldenHour: times.goldenHour,
      sunset: times.sunset,
      dusk: times.dusk,
      solarNoon: times.solarNoon,
      alwaysUp: times.alwaysUp === true,
      alwaysDown: times.alwaysDown === true,
    };
  }

  function eventView(key, date, timeZone, now) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
    const meta = EVENT_META[key] || { name: '正午', lead: '正午', note: '', dot: 'day' };
    const minute = minuteOfDay(date, timeZone, true);
    const nowStamp = Math.floor(now.getTime() / 60000);
    const eventStamp = Math.round(date.getTime() / 60000);
    return {
      key,
      name: meta.name,
      lead: meta.lead,
      note: meta.note,
      dot: meta.dot,
      date,
      minute,
      hm: formatHM(date, timeZone),
      delta: eventStamp - nowStamp,
    };
  }

  function buildSunModel(input) {
    const lat = Number(input && input.lat);
    const lng = Number(input && input.lng);
    const timeZone = String((input && input.timeZone) || 'UTC');
    const now = input && input.now instanceof Date ? input.now : new Date(input && input.now);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(now.getTime())) return null;
    const noon = civilNoon(now, timeZone);
    const today = readTimes(noon, lat, lng);
    const yesterday = readTimes(shiftCivilNoon(now, timeZone, -1), lat, lng);
    const tomorrow = readTimes(shiftCivilNoon(now, timeZone, 1), lat, lng);
    const nowMin = minuteOfDay(now, timeZone, false);
    const marks = {};
    const events = {};
    EVENT_ORDER.forEach((key) => {
      const view = eventView(key, today[key], timeZone, now);
      events[key] = view;
      marks[key] = view ? view.minute : null;
    });
    const flags = { alwaysUp: today.alwaysUp, alwaysDown: today.alwaysDown };
    const phase = phaseAt(nowMin, marks, flags);
    const position = SunCalc.getPosition(now, lat, lng);
    const noonView = eventView('solarNoon', today.solarNoon, timeZone, now);
    const noonPos = today.solarNoon ? SunCalc.getPosition(today.solarNoon, lat, lng) : null;

    let next = null;
    if (!flags.alwaysUp && !flags.alwaysDown) {
      for (const key of EVENT_ORDER) {
        if (events[key] && events[key].delta > 0) {
          next = events[key];
          break;
        }
      }
      if (!next && tomorrow.dawn) {
        const view = eventView('dawn', tomorrow.dawn, timeZone, now);
        next = view && {
          ...view,
          key: 'tomorrowDawn',
          name: '明早天亮',
          lead: '明早天亮',
        };
      }
    }

    const dayLengthMin = today.sunrise && today.sunset
      ? (today.sunset.getTime() - today.sunrise.getTime()) / 60000
      : null;
    const yesterdayLength = yesterday.sunrise && yesterday.sunset
      ? yesterday.sunset.getTime() - yesterday.sunrise.getTime()
      : null;
    const todayLength = today.sunrise && today.sunset
      ? today.sunset.getTime() - today.sunrise.getTime()
      : null;
    const deltaVsYesterdaySec = todayLength != null && yesterdayLength != null
      ? Math.round((todayLength - yesterdayLength) / 1000)
      : null;

    const upcoming = EVENT_ORDER
      .map((key) => events[key])
      .filter((item) => item && item.delta > 0);
    if (!flags.alwaysUp && !flags.alwaysDown) {
      if (upcoming.length < 3 && tomorrow.dawn) {
        const dawn = eventView('dawn', tomorrow.dawn, timeZone, now);
        if (dawn) upcoming.push({ ...dawn, key: 'tomorrowDawn', name: '明天天亮', lead: '明早天亮' });
      }
      if (upcoming.length < 3 && tomorrow.sunrise) {
        const sunrise = eventView('sunrise', tomorrow.sunrise, timeZone, now);
        if (sunrise) upcoming.push({ ...sunrise, key: 'tomorrowSunrise', name: '明天日出', lead: '日出' });
      }
    }

    const civil = civilParts(now, timeZone);
    const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone, weekday: 'short' }).format(now);
    let start = nowMin - 30;
    let end = nowMin + 30;
    if (marks.dawn != null) start = Math.min(start, marks.dawn - 90);
    if (marks.dusk != null) end = Math.max(end, marks.dusk + 90);
    if (marks.dawn == null && marks.dusk == null) {
      start = 0;
      end = 1440;
    }
    const samples = [];
    for (let minute = start; minute <= end + 0.01; minute += 3) {
      const at = dateAtMinute(noon, timeZone, minute);
      samples.push([minute, SunCalc.getPosition(at, lat, lng).altitude]);
    }

    const sub = (() => {
      if (!events.sunset || flags.alwaysUp || flags.alwaysDown) return null;
      if (next && next.key !== 'sunset' && events.sunset.delta > 0) {
        return { kind: 'sunset', hm: events.sunset.hm, parts: durationParts(events.sunset.delta) };
      }
      if (tomorrow.sunrise) return { kind: 'tomorrow', hm: formatHM(tomorrow.sunrise, timeZone) };
      return null;
    })();

    return {
      timeZone,
      now,
      nowMin,
      nowHM: formatNowHM(now, timeZone),
      phase,
      skySide: today.solarNoon && now.getTime() < today.solarNoon.getTime() ? 'east' : 'west',
      polar: flags.alwaysUp ? 'up' : flags.alwaysDown ? 'down' : null,
      altitude: position.altitude,
      azimuth: position.azimuth,
      events,
      marks,
      next,
      upcoming: upcoming.slice(0, 3),
      solarNoon: noonView && noonPos ? {
        hm: noonView.hm,
        minute: noonView.minute,
        altitude: noonPos.altitude,
      } : null,
      dayLengthMin,
      dayLengthParts: dayLengthMin == null ? null : durationParts(Math.round(dayLengthMin)),
      deltaVsYesterday: formatSignedDelta(deltaVsYesterdaySec),
      tomorrow: {
        dawn: tomorrow.dawn ? formatHM(tomorrow.dawn, timeZone) : null,
        sunrise: tomorrow.sunrise ? formatHM(tomorrow.sunrise, timeZone) : null,
        sunset: tomorrow.sunset ? formatHM(tomorrow.sunset, timeZone) : null,
      },
      dateLabel: `${civil.month}月${civil.day}日 ${weekday}`,
      sub,
      arc: { start, end, samples },
    };
  }

  function normalizeQuery(query) {
    return String(query || '').trim().toLowerCase().replace(/[\s,，]+/g, '');
  }

  function scoreCity(city, query) {
    const name = String(city.name || '').toLowerCase();
    const py = String(city.py || '');
    const ini = String(city.ini || '');
    const en = String(city.enKey || '');
    const enIni = String(city.enIni || '');
    if (!query) return 0;
    if (name === query) return 10000;
    if (py === query || en === query) return 9000;
    if (ini === query || enIni === query) return 8500;
    if (name.startsWith(query)) return 8000;
    if (py.startsWith(query) || en.startsWith(query)) return 7000 + Math.max(0, 200 - py.length);
    if (ini.startsWith(query) || enIni.startsWith(query)) return 5000;
    if (name.includes(query)) return 4000;
    if (py.includes(query) || en.includes(query)) return 3000;
    if (String(city.admin || '').toLowerCase().includes(query)) return 1000;
    return 0;
  }

  function searchCities(cities, query, limit) {
    const needle = normalizeQuery(query);
    const list = Array.isArray(cities) ? cities : [];
    const cap = Math.max(1, Math.min(20, Number(limit) || 8));
    if (!needle) return [];
    return list
      .map((city) => ({ city, score: scoreCity(city, needle) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || String(a.city.name).length - String(b.city.name).length)
      .slice(0, cap)
      .map((item) => item.city);
  }

  function cityLabel(city) {
    if (!city || !city.name) return '';
    return city.admin ? `${city.name}, ${city.admin}` : String(city.name);
  }

  function suggestCity(cities, timeZone) {
    const list = Array.isArray(cities) ? cities : [];
    const zone = String(timeZone || '');
    const preferred = TZ_SUGGESTIONS[zone];
    if (preferred) {
      const match = list.find((city) => city.name === preferred.name && (!preferred.admin || city.admin === preferred.admin))
        || list.find((city) => city.name === preferred.name);
      if (match) return match;
    }
    return list.find((city) => city.tz === zone) || null;
  }

  function parseManualLocation(latText, lngText, name) {
    const lat = Number(String(latText ?? '').trim());
    const lng = Number(String(lngText ?? '').trim());
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: '纬度需要在 -90 到 90 之间' };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: '经度需要在 -180 到 180 之间' };
    const label = String(name || '').trim().slice(0, 24);
    return {
      ok: true,
      location: {
        source: 'manual',
        id: 'manual',
        name: label || '自定义位置',
        admin: '自定义',
        lat,
        lng,
        tz: null,
      },
    };
  }

  function locationFromCity(city) {
    if (!city) return null;
    return {
      source: 'city',
      id: city.id,
      name: city.name,
      admin: city.admin,
      lat: city.lat,
      lng: city.lng,
      tz: city.tz || null,
    };
  }

  return {
    EVENT_ORDER,
    EVENT_META,
    ARC,
    NOW_FS,
    MINI_FOOT_INNER_WIDTH,
    estimateMiniFootWidth,
    miniFootFitsCard,
    civilParts,
    civilNoon,
    formatHM,
    formatNowHM,
    placeNowLabel,
    minuteOfDay,
    durationParts,
    durationText,
    phaseAt,
    skyAsset,
    buildSunModel,
    searchCities,
    cityLabel,
    suggestCity,
    parseManualLocation,
    locationFromCity,
    floorMinute,
    roundMinute,
  };
});
