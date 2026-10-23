const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sun = require('../renderer/sun');
const domain = require('../renderer/domain');
const cities = JSON.parse(fs.readFileSync(path.join(__dirname, '../renderer/cities.json'), 'utf8'));

const SHANGHAI = { lat: 31.23, lng: 121.47, timeZone: 'Asia/Shanghai' };

function shanghaiAt(hour, minute, second = 0) {
  const guess = Date.UTC(2026, 9, 8, hour, minute, second);
  const offset = 8 * 60;
  return new Date(guess - offset * 60000);
}

test('suncalc matches the Shanghai 2026-10-08 design sample', () => {
  const now = shanghaiAt(16, 30, 0);
  const model = sun.buildSunModel({ ...SHANGHAI, now });
  assert.equal(model.phase, 'day');
  assert.equal(model.skySide, 'west');
  assert.equal(model.events.dawn.hm, '05:28');
  assert.equal(model.events.sunrise.hm, '05:52');
  assert.equal(model.events.goldenHourEnd.hm, '06:24');
  assert.equal(model.solarNoon.hm, '11:42');
  assert.equal(model.events.goldenHour.hm, '16:59');
  assert.equal(model.events.sunset.hm, '17:31');
  assert.equal(model.events.dusk.hm, '17:55');
  assert.ok(Math.abs(model.altitude - 12.09) < 0.08, `altitude ${model.altitude}`);
  assert.ok(Math.abs(model.azimuth - 255.4) < 0.4, `azimuth ${model.azimuth}`);
  assert.equal(model.next.lead, '下午黄金时刻');
  assert.equal(model.next.delta, 29);
  const later = sun.buildSunModel({ ...SHANGHAI, now: shanghaiAt(16, 30, 50) });
  assert.equal(later.next.delta, 29);
  assert.deepEqual(model.dayLengthParts, [{ n: 11, u: '小时' }, { n: 39, u: '分' }]);
  assert.equal(model.deltaVsYesterday.sign, '−');
  assert.equal(model.deltaVsYesterday.minutes, 1);
  assert.equal(model.deltaVsYesterday.seconds, 52);
  assert.equal(model.tomorrow.dawn, '05:28');
  assert.equal(model.tomorrow.sunrise, '05:53');
  assert.equal(sun.skyAsset('medium', model.phase), 'assets/sun-sky-day.webp');
  assert.equal(sun.skyAsset('large', 'night'), 'assets/sun-sky-night-tall.webp');

  const golden = sun.buildSunModel({ ...SHANGHAI, now: shanghaiAt(17, 10) });
  assert.equal(golden.phase, 'golden');
  const blue = sun.buildSunModel({ ...SHANGHAI, now: shanghaiAt(5, 40) });
  assert.equal(blue.phase, 'blue');
  assert.equal(blue.skySide, 'east');
  const night = sun.buildSunModel({ ...SHANGHAI, now: shanghaiAt(21, 40) });
  assert.equal(night.phase, 'night');
  assert.equal(night.next.lead, '明早天亮');
});

test('current-time label follows Design B side, edge flip, night, and HH:MM format', () => {
  const preSunrise = sun.buildSunModel({ ...SHANGHAI, now: shanghaiAt(5, 40) });
  assert.equal(preSunrise.nowHM, '05:40');
  assert.equal(preSunrise.skySide, 'east');
  assert.ok(preSunrise.altitude < -0.83, 'pre-sunrise sits below the horizon');
  const prePlace = sun.placeNowLabel({
    size: 'medium',
    skySide: preSunrise.skySide,
    nx: 72,
    ny: 82,
    up: false,
    markerR: sun.ARC.medium.markerR,
    width: sun.ARC.medium.w,
  });
  assert.equal(prePlace.left, true);
  assert.equal(prePlace.anchor, 'end');
  assert.equal(prePlace.night, true);
  assert.equal(prePlace.fontSize, 12.5);

  const morning = sun.buildSunModel({ ...SHANGHAI, now: shanghaiAt(6, 10) });
  assert.equal(morning.nowHM, '06:10');
  assert.equal(morning.skySide, 'east');
  assert.ok(morning.altitude >= -0.83, 'post-sunrise marker is above the horizon');
  const morningPlace = sun.placeNowLabel({
    size: 'medium',
    skySide: morning.skySide,
    nx: 90,
    ny: 70,
    up: true,
    markerR: sun.ARC.medium.markerR,
    width: sun.ARC.medium.w,
  });
  assert.equal(morningPlace.left, true, 'morning rising sun keeps the label on the left');
  assert.equal(morningPlace.night, false);

  const afternoon = sun.buildSunModel({ ...SHANGHAI, now: shanghaiAt(13, 23) });
  assert.equal(afternoon.nowHM, '13:23');
  assert.equal(afternoon.skySide, 'west');
  assert.match(afternoon.nowHM, /^\d{2}:\d{2}$/);
  assert.equal(afternoon.nowHM.includes(':'), true);
  assert.ok(!/\d{2}:\d{2}:\d{2}/.test(afternoon.nowHM));
  const afternoonPlace = sun.placeNowLabel({
    size: 'large',
    skySide: afternoon.skySide,
    nx: 220,
    ny: 60,
    up: true,
    markerR: sun.ARC.large.markerR,
    width: sun.ARC.large.w,
  });
  assert.equal(afternoonPlace.left, false);
  assert.equal(afternoonPlace.anchor, 'start');
  assert.equal(afternoonPlace.night, false);
  assert.equal(afternoonPlace.fontSize, 13);

  const night = sun.buildSunModel({ ...SHANGHAI, now: shanghaiAt(21, 40) });
  assert.equal(night.nowHM, '21:40');
  assert.equal(night.phase, 'night');
  const nightPlace = sun.placeNowLabel({
    size: 'medium',
    skySide: night.skySide,
    nx: sun.ARC.medium.w - 8,
    ny: 90,
    up: false,
    markerR: sun.ARC.medium.markerR,
    width: sun.ARC.medium.w,
  });
  assert.equal(nightPlace.night, true, `night flag ${JSON.stringify(nightPlace)}`);
  assert.equal(nightPlace.left, true, `night side ${JSON.stringify(nightPlace)}`); // west + near right edge → flip left

  const edgeRight = sun.placeNowLabel({
    size: 'medium',
    skySide: 'west',
    nx: sun.ARC.medium.w - 6,
    ny: 70,
    up: true,
    markerR: sun.ARC.medium.markerR,
    width: sun.ARC.medium.w,
  });
  assert.equal(edgeRight.left, true, 'afternoon label flips left near the right card edge');

  const edgeLeft = sun.placeNowLabel({
    size: 'medium',
    skySide: 'east',
    nx: 6,
    ny: 70,
    up: true,
    markerR: sun.ARC.medium.markerR,
    width: sun.ARC.medium.w,
  });
  assert.equal(edgeLeft.left, false, 'morning label flips right near the left card edge');

  const smallPeak = sun.placeNowLabel({
    size: 'small',
    skySide: 'east',
    nx: 80,
    ny: 18,
    up: true,
    markerR: sun.ARC.small.markerR,
    width: sun.ARC.small.w,
  });
  assert.equal(smallPeak.left, false, 'small near-noon flips away from countdown 分');
  assert.equal(smallPeak.fontSize, 11.5);
  assert.equal(sun.NOW_FS.mini, 11.5);
  assert.equal(sun.NOW_FS.medium, 12.5);

  const polarDay = sun.buildSunModel({
    lat: 78,
    lng: 15,
    timeZone: 'UTC',
    now: new Date(Date.UTC(2026, 5, 21, 12, 0, 0)),
  });
  assert.match(polarDay.nowHM, /^\d{2}:\d{2}$/);
  const polarNight = sun.buildSunModel({
    lat: 78,
    lng: 15,
    timeZone: 'UTC',
    now: new Date(Date.UTC(2026, 11, 21, 12, 0, 0)),
  });
  assert.match(polarNight.nowHM, /^\d{2}:\d{2}$/);
  const polarNightPlace = sun.placeNowLabel({
    size: 'medium',
    skySide: polarNight.skySide,
    nx: 180,
    ny: 90,
    up: false,
    markerR: sun.ARC.medium.markerR,
    width: sun.ARC.medium.w,
  });
  assert.equal(polarNightPlace.night, true);
});

test('mini footer keeps full HH:MM within the ~190px card content width', () => {
  const widget = fs.readFileSync(path.join(__dirname, '../renderer/sun-widget.js'), 'utf8');
  const miniFootLine = widget.split('\n').find((line) => line.includes('sun-mini-foot'))?.replace(/\\"/g, '"');
  assert.ok(miniFootLine);
  assert.match(miniFootLine, /class="edge edge-rise"/);
  assert.doesNotMatch(miniFootLine, /class="sep"|·/);

  const cssText = fs.readFileSync(path.join(__dirname, '../renderer/styles.css'), 'utf8');
  const footBlocks = cssText.match(/\.sun-mini-foot[\s\S]*?\}/g) || [];
  footBlocks.forEach((block) => {
    assert.doesNotMatch(block, /text-overflow:\s*ellipsis/, `mini foot rule must not ellipsis: ${block.slice(0, 80)}`);
  });

  assert.ok(sun.miniFootFitsCard({ riseHm: '05:53', nowHm: '13:23', setHm: '17:30' }));
  assert.ok(sun.miniFootFitsCard({ riseHm: '05:28', nowHm: '23:59', setHm: '17:55' }));
  assert.equal(sun.MINI_FOOT_INNER_WIDTH, 170);
});

test('polar day and polar night do not invent missing solar events', () => {
  const polarDay = sun.buildSunModel({
    lat: 78,
    lng: 15,
    timeZone: 'UTC',
    now: new Date(Date.UTC(2026, 5, 21, 12, 0, 0)),
  });
  const polarNight = sun.buildSunModel({
    lat: 78,
    lng: 15,
    timeZone: 'UTC',
    now: new Date(Date.UTC(2026, 11, 21, 12, 0, 0)),
  });
  assert.equal(polarDay.polar, 'up');
  assert.equal(polarDay.phase, 'day');
  assert.equal(polarDay.events.sunrise, null);
  assert.equal(polarDay.events.sunset, null);
  assert.equal(polarDay.next, null);
  assert.equal(polarNight.polar, 'down');
  assert.equal(polarNight.phase, 'night');
  assert.equal(polarNight.events.dawn, null);
  assert.equal(polarNight.events.dusk, null);
});

test('city search matches Chinese, pinyin, and initials, and keeps coordinates', () => {
  const ids = cities.map((city) => city.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(cities.filter((city) => String(city.id).startsWith('cn-')).length >= 330);
  assert.ok(cities.some((city) => city.admin === '中国' && city.name === '香港'));
  assert.ok(cities.some((city) => city.admin === '台湾' && city.name === '台北'));

  const byName = sun.searchCities(cities, '上海', 5);
  assert.equal(byName[0].name, '上海');
  assert.equal(byName[0].admin, '中国');
  assert.equal(byName[0].lat, 31.2317);
  assert.equal(byName[0].lng, 121.4726);
  assert.equal(sun.cityLabel(byName[0]), '上海, 中国');

  const byPinyin = sun.searchCities(cities, 'shanghai', 5);
  assert.equal(byPinyin[0].id, byName[0].id);

  const byInitials = sun.searchCities(cities, 'sh', 8);
  assert.equal(byInitials[0].name, '上海');
  assert.equal(byInitials[0].lat, 31.2317);

  const hangzhou = sun.searchCities(cities, 'hangzhou', 5)[0];
  assert.equal(hangzhou.name, '杭州');
  assert.equal(sun.cityLabel(hangzhou), '杭州, 浙江');
  assert.equal(hangzhou.lat, 30.246);
  assert.equal(hangzhou.lng, 120.2108);
  const located = sun.locationFromCity(hangzhou);
  assert.equal(located.lat, hangzhou.lat);
  assert.equal(located.lng, hangzhou.lng);
  assert.equal(located.tz, 'Asia/Shanghai');

  const suggested = sun.suggestCity(cities, 'Asia/Shanghai');
  assert.equal(suggested.name, '上海');
  assert.equal(suggested.admin, '中国');
  const manual = sun.parseManualLocation('31.23', '121.47', '自定义');
  assert.equal(manual.ok, true);
  assert.equal(manual.location.lat, 31.23);
  assert.equal(manual.location.lng, 121.47);
  assert.equal(sun.parseManualLocation('91', '0').ok, false);
});

test('introducing the sun module never reorders or relocates an existing layout', () => {
  const previous = ['music', 'pomodoro', 'cursor', 'windows', 'recorder', 'mirror', 'note', 'commands'];
  const registry = [...previous, 'sun'];
  const defaults = {
    music: 'small',
    windows: 'large',
    recorder: 'small',
    mirror: 'medium',
    note: 'medium',
    commands: 'mini',
    pomodoro: 'mini',
    cursor: 'small',
    sun: 'medium',
  };
  const packed = domain.packHomeWidgetLayout(previous, defaults, 12, 4, true);
  assert.ok(packed);
  const full = domain.introduceHomeModule({
    order: previous,
    sizes: defaults,
    defaults,
    placements: packed,
    hiddenIds: [],
    moduleId: 'sun',
    defaultSize: 'medium',
    registry,
  });
  assert.deepEqual(full.order, [...previous, 'sun']);
  previous.forEach((id) => {
    assert.deepEqual(full.placements[id], packed[id]);
    assert.equal(full.sizes[id], defaults[id]);
  });
  assert.equal(full.placements.sun, undefined);
  assert.deepEqual(full.hiddenIds, ['sun']);

  const trailing = {
    music: { column: 0, row: 0, width: 12, height: 2 },
  };
  const appended = domain.introduceHomeModule({
    order: ['note', 'music'],
    sizes: { note: 'medium', music: 'small', sun: 'medium' },
    defaults: { note: 'medium', music: 'small', sun: 'medium' },
    placements: trailing,
    hiddenIds: [],
    moduleId: 'sun',
    defaultSize: 'medium',
    registry: ['music', 'note', 'sun'],
  });
  assert.deepEqual(appended.order, ['note', 'music', 'sun']);
  assert.deepEqual(appended.placements.music, trailing.music);
  assert.ok(appended.placements.sun);
  assert.ok(appended.placements.sun.row * 12 + appended.placements.sun.column > 1 * 12 + 11);
  assert.deepEqual(appended.hiddenIds, []);

  const alreadyPlaced = {
    music: { column: 0, row: 0, width: 4, height: 2 },
    sun: { column: 8, row: 2, width: 4, height: 2 },
  };
  const kept = domain.introduceHomeModule({
    order: ['music', 'sun'],
    sizes: { music: 'large', sun: 'large', note: 'large' },
    defaults: { music: 'medium', sun: 'medium', note: 'medium' },
    placements: alreadyPlaced,
    hiddenIds: ['note'],
    moduleId: 'sun',
    defaultSize: 'medium',
    registry: ['music', 'note', 'sun'],
  });
  assert.deepEqual(kept.placements.sun, alreadyPlaced.sun);
  assert.deepEqual(kept.placements.music, alreadyPlaced.music);
  assert.deepEqual(kept.hiddenIds, ['note']);

  const fresh = domain.introduceHomeModule({
    order: previous,
    sizes: defaults,
    defaults,
    placements: null,
    hiddenIds: [],
    moduleId: 'sun',
    defaultSize: 'medium',
    registry,
  });
  assert.equal(fresh.placements, null);
  assert.deepEqual(fresh.hiddenIds, ['sun']);
  previous.forEach((id) => assert.equal(fresh.sizes[id], defaults[id]));
});

test('blank, missing and invalid coordinates cannot become a false zero-island location', () => {
  for (const value of ['', ' ', null, undefined, false, true, [], {}, 'NaN', 'Infinity', Infinity]) {
    assert.equal(sun.parseCoordinate(value,90),null);
    assert.equal(sun.parseManualLocation(value,'0').ok,false);
    assert.equal(sun.parseManualLocation('0',value).ok,false);
  }
  assert.equal(sun.parseCoordinate('0',90),0);assert.equal(sun.parseCoordinate(0,180),0);
  assert.equal(sun.parseManualLocation('-90','180').ok,true);
  assert.equal(sun.parseManualLocation('90.001','0').ok,false);
  assert.equal(sun.parseManualLocation('0','-180.001').ok,false);
});

function occupiedCells(placements, columns = 12, rows = 4) {
  const cells = Array(columns * rows).fill(0);
  Object.values(placements).forEach((item) => {
    for (let row = item.row; row < item.row + item.height; row += 1) {
      for (let column = item.column; column < item.column + item.width; column += 1) {
        cells[row * columns + column] += 1;
      }
    }
  });
  return cells;
}

test('fitting sun into a full homepage without counting hidden modules leaves no gaps', () => {
  const area = { mini: 2, small: 4, medium: 8, large: 16 };
  // Seven visible modules fill the grid; music is hidden but still present in saved sizes.
  const sizes = {
    music: 'small',
    pomodoro: 'mini',
    cursor: 'medium',
    recorder: 'small',
    windows: 'large',
    mirror: 'medium',
    note: 'medium',
    commands: 'mini',
    sun: 'medium',
  };
  const visibleBefore = ['recorder', 'pomodoro', 'cursor', 'mirror', 'note', 'commands', 'windows'];
  assert.equal(visibleBefore.reduce((sum, id) => sum + area[sizes[id]], 0), 48);
  const before = domain.packHomeWidgetLayout(visibleBefore, sizes, 12, 4, true);
  assert.ok(before);
  assert.deepEqual(occupiedCells(before), Array(48).fill(1));

  const visible = [...visibleBefore, 'sun'];
  // Bug: counting the hidden music card made the visible set undersized.
  const buggy = domain.normalizeHomeWidgetSizes(sizes, sizes, 'sun', 48);
  const buggyVisibleArea = visible.reduce((sum, id) => sum + area[buggy[id]], 0);
  assert.ok(buggyVisibleArea < 48);

  const visibleDefaults = Object.fromEntries(visible.map((id) => [id, sizes[id]]));
  const fitted = domain.normalizeHomeWidgetSizes(
    Object.fromEntries(visible.map((id) => [id, sizes[id]])),
    visibleDefaults,
    'sun',
    48
  );
  assert.equal(visible.reduce((sum, id) => sum + area[fitted[id]], 0), 48);
  const packed = domain.packHomeWidgetLayout(visible, fitted, 12, 4, true);
  assert.ok(packed);
  assert.deepEqual(occupiedCells(packed), Array(48).fill(1));

  const shrunk = visible.filter((id) => id !== 'sun' && area[fitted[id]] < area[sizes[id]]);
  const sealed = domain.fillHomeLayoutGaps(packed, { preferredIds: shrunk });
  assert.equal(sealed.gapCount, 0);
  assert.deepEqual(occupiedCells(sealed.placements), Array(48).fill(1));
});

test('saved layouts with a hole beside a shrunk neighbor are repaired without reshuffling others', () => {
  // Mirror was medium, got shrunk to small; the freed 2×2 beside it stayed empty while sun
  // landed elsewhere. Fill should grow mirror back and leave every other card in place.
  const fixture = {
    recorder: { column: 0, row: 0, width: 2, height: 2 },
    pomodoro: { column: 0, row: 2, width: 2, height: 2 },
    cursor: { column: 2, row: 0, width: 4, height: 2 },
    mirror: { column: 6, row: 0, width: 2, height: 2 },
    commands: { column: 10, row: 0, width: 2, height: 4 },
    note: { column: 2, row: 2, width: 4, height: 2 },
    windows: { column: 6, row: 2, width: 2, height: 2 },
    sun: { column: 8, row: 2, width: 2, height: 2 },
  };
  assert.equal(occupiedCells(fixture).filter((count) => count === 0).length, 4);

  const unchanged = {
    recorder: { ...fixture.recorder },
    pomodoro: { ...fixture.pomodoro },
    cursor: { ...fixture.cursor },
    commands: { ...fixture.commands },
    note: { ...fixture.note },
    windows: { ...fixture.windows },
    sun: { ...fixture.sun },
  };
  const repaired = domain.fillHomeLayoutGaps(fixture, { preferredIds: ['mirror'] });
  assert.equal(repaired.changed, true);
  assert.equal(repaired.gapCount, 0);
  assert.deepEqual(occupiedCells(repaired.placements), Array(48).fill(1));
  assert.deepEqual(repaired.placements.mirror, { column: 6, row: 0, width: 4, height: 2 });
  assert.equal(repaired.sizes.mirror, 'medium');
  Object.entries(unchanged).forEach(([id, item]) => {
    assert.deepEqual(repaired.placements[id], item, `${id} should keep its origin and footprint`);
  });

  const loaded = domain.fillHomeLayoutGaps(fixture, {});
  assert.equal(loaded.gapCount, 0);
  assert.deepEqual(loaded.placements.mirror, { column: 6, row: 0, width: 4, height: 2 });

  // Empty strip under the mirror (user screenshot): mirror stays put and grows down.
  const belowHole = {
    recorder: { column: 0, row: 0, width: 2, height: 2 },
    pomodoro: { column: 0, row: 2, width: 2, height: 2 },
    cursor: { column: 2, row: 0, width: 2, height: 2 },
    mirror: { column: 4, row: 0, width: 4, height: 2 },
    commands: { column: 8, row: 0, width: 4, height: 2 },
    note: { column: 8, row: 2, width: 4, height: 2 },
    windows: { column: 2, row: 2, width: 2, height: 2 },
    sun: { column: 4, row: 2, width: 2, height: 2 },
  };
  // hole at (6,2)-(7,3). Prefer growing sun (left neighbor) or mirror can't grow to
  // large because commands/note occupy the right. sun small→medium fills the hole.
  assert.equal(occupiedCells(belowHole).filter((count) => count === 0).length, 4);
  const fixedBelow = domain.fillHomeLayoutGaps(belowHole, { preferredIds: ['mirror', 'sun'] });
  assert.equal(fixedBelow.gapCount, 0);
  assert.deepEqual(
    { column: fixedBelow.placements.mirror.column, row: fixedBelow.placements.mirror.row,
      width: fixedBelow.placements.mirror.width, height: fixedBelow.placements.mirror.height },
    belowHole.mirror
  );
  assert.deepEqual(fixedBelow.placements.sun, { column: 4, row: 2, width: 4, height: 2 });
  assert.deepEqual(fixedBelow.placements.commands, belowHole.commands);
  assert.deepEqual(fixedBelow.placements.note, belowHole.note);
});
