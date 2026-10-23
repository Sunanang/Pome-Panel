'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSunWeatherService, normalizeCurrent, weatherLocation, WEATHER_INTERVAL_MS } = require('../sunWeather');
const Weather = require('../renderer/weather-domain');
const FX = require('../renderer/weather-effects');
const I18n = require('../localization/runtime');

const current = (code = 0, temperature = 10.7) => ({ current: { temperature_2m: temperature,
  relative_humidity_2m: 78, weather_code: code, wind_speed_10m: 0 }, current_units: { wind_speed_10m: 'km/h' } });
const response = value => new Response(JSON.stringify(value));
const place = { lat: 39.9042, lng: 116.4074 };

test('weather requests accept finite coordinates only and normalize zero temperatures / humidity', () => {
  for (const input of [null, {}, { lat: null, lng: 0 }, { lat: '0', lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: Infinity }]) assert.equal(weatherLocation(input), null);
  assert.equal(weatherLocation({ lat: 0, lng: 0 }).key, '0.000000,0.000000');
  assert.equal(normalizeCurrent(current(0, 0)).temperature, 0);
  const value = current(); value.current.relative_humidity_2m = 0;
  assert.equal(normalizeCurrent(value).humidity, 0);
  value.current.temperature_2m = null; assert.equal(normalizeCurrent(value), null);
  const explicit = current(); explicit.current.condition = 'haze';
  assert.equal(normalizeCurrent(explicit).condition, 'haze');
});

test('weather fetches current fields from the fixed HTTPS endpoint, coalesces and waits for a wake after 30 minutes', async () => {
  let clock = 1000, calls = 0, release;
  const service = createSunWeatherService({ now: () => clock, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://api.open-meteo.com'); assert.equal(url.pathname, '/v1/forecast');
    assert.equal(url.searchParams.get('latitude'), String(place.lat));
    assert.equal(url.searchParams.get('current'), 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m');
    assert.equal(url.searchParams.get('hourly'), null); assert.equal(options.redirect, 'error');
    await new Promise(resolve => { release = resolve; }); return response(current());
  } });
  const first = service.get(place), duplicate = service.get(place);
  await Promise.resolve(); assert.equal(calls, 1); release();
  const data = await first; assert.deepEqual(await duplicate, data);
  clock += WEATHER_INTERVAL_MS - 1; assert.deepEqual(await service.get(place), data); assert.equal(calls, 1);
  clock += 100000; await Promise.resolve(); assert.equal(calls, 1, 'elapsed wall time alone never polls');
  const next = service.get(place); await Promise.resolve(); assert.equal(calls, 2); release(); await next;
});

test('offline, invalid JSON/current and 429 retain successful readings; failures throttle too, including across restarts', async () => {
  let clock = 0, calls = 0, stored;
  let fetcher = async () => response(current(61));
  const options = { now: () => clock, readCache: () => stored,
    saveCache: value => { stored = JSON.parse(JSON.stringify(value)); },
    fetchImpl: (...args) => { calls++; return fetcher(...args); } };
  let service = createSunWeatherService(options);
  const good = await service.get(place);
  for (const bad of [() => { throw new Error('offline'); }, async () => new Response('invalid'), async () => response({current: {}}), async () => new Response('', { status: 429 })]) {
    fetcher = bad; clock += WEATHER_INTERVAL_MS;
    assert.deepEqual(await service.get(place), good);
    service = createSunWeatherService(options);
    const before = calls; assert.deepEqual(await service.get(place), good); assert.equal(calls, before);
  }
});

test('never-successful and invalid locations are silent empty states, with bounded response bodies', async () => {
  let calls = 0;
  const service = createSunWeatherService({ fetchImpl: async () => { calls++; return new Response('x'.repeat(70000)); } });
  assert.equal(await service.get({ lat: 999, lng: 0 }), null); assert.equal(calls, 0);
  assert.equal(await service.get(place), null); assert.equal(await service.get(place), null); assert.equal(calls, 1);
});

test('weather cache isolates locations and a new service reuses successful data without a request', async () => {
  let saved;
  const service = createSunWeatherService({ now: () => 1000, saveCache: value => { saved = structuredClone(value); },
    fetchImpl: async url => response(current(0, Number(url.searchParams.get('latitude')))) });
  assert.equal((await service.get(place)).temperature, place.lat);
  assert.equal((await service.get({ lat: 1, lng: 2 })).temperature, 1);
  const restarted = createSunWeatherService({ now: () => 2000, readCache: () => saved, fetchImpl: () => { throw new Error('must not fetch'); } });
  assert.equal((await restarted.get(place)).temperature, place.lat);
});

test('WMO and independent fallback conditions preserve rain, fog versus haze and wind thresholds', () => {
  for (const [code, expected] of [[0,'none'],[45,'fog'],[48,'fog'],[56,'drizzle'],[61,'rain-light'],[63,'rain-mid'],[65,'rain-heavy'],[71,'snow-light'],[73,'snow-mid'],[75,'snow-heavy'],[77,'snow-light'],[86,'snow-heavy'],[95,'thunder'],[96,'hail'],[99,'hail']]) {
    assert.equal(Weather.classify({code, temperature: 12}).family, expected);
  }
  for (const condition of ['haze', 'dust', 'sleet', 'hail']) assert.equal(Weather.classify({condition, temperature: 12}).family, condition);
  assert.equal(Weather.classify({code: 0, temperature: 12, humidity: 20}).name, 'clear', 'humidity alone never invents haze or dust');
  for (const [speed, family] of [[24.9,'none'],[25,'wind'],[40,'wind-strong']]) assert.equal(Weather.classify({code:0,temperature:12,windSpeed:speed}).family, family);
  const windyRain = Weather.classify({code:65,temperature:12,windSpeed:45});
  assert.equal(windyRain.name, 'heavyRain'); assert.equal(windyRain.family, 'rain-wind');
  assert.equal(Weather.classify({code:999,temperature:10}).available, false);
});

test('capsules round compact temperatures, shorten long labels, and only large adds humidity', () => {
  const t = (key, params) => I18n.t(key, params, 'zh-CN');
  const data = {code:96,temperature:10.7,humidity:78};
  assert.equal(Weather.view(data,'mini',t).text, '11°');
  assert.equal(Weather.view(data,'small',t).text, '雷雹 · 11°');
  assert.equal(Weather.view(data,'medium',t).text, '雷暴冰雹 · 10.7°');
  assert.equal(Weather.view(data,'large',t).text, '雷暴冰雹 · 10.7° · 湿度 78%');
  assert.equal(Weather.view(null,'medium',t).text, '天气 · --°');
});

test('precipitation budgets and movement are bounded, snow oscillates and wind crosses horizontally', () => {
  const random = () => .5;
  for (const [family, max] of [['rain-heavy',80],['snow-heavy',50],['hail',35],['sleet',80],['rain-wind',80]]) assert(FX.scene(family,400,250,random).particles.length <= max);
  const rain = FX.scene('rain-mid',1000,1000,random), p = rain.particles[0], start = {x:p.x,y:p.y};
  FX.step(rain,1); assert(p.y>start.y && p.x<start.x);
  const snow=FX.scene('snow-mid',1000,1000,random), s=snow.particles[0], sx=s.x;
  for(let i=0;i<60;i++)FX.step(snow,.05);
  assert(Math.abs(s.x-sx)<.01); assert(s.y>500);
  const wind=FX.scene('wind-strong',1000,1000,random), w=wind.particles[0];
  FX.step(wind,1); assert(w.x>500); assert.equal(w.y,500);
  assert.equal(FX.scene('none',400,250).particles.length,0);
});

test('thunder flashes at 4–8 second intervals for 140ms with a maximum alpha of .22', () => {
  const s=FX.scene('thunder',400,250,()=>.5);
  FX.step(s,5.99);assert.equal(s.flash,0);
  FX.step(s,.01);assert.equal(s.flash,0);
  FX.step(s,.07);assert(s.flash>.21&&s.flash<=.22);
  FX.step(s,.08);assert.equal(s.flash,0);assert.equal(s.nextFlash,12);
});
