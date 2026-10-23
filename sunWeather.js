'use strict';

const { readLimitedBody } = require('./public-http');

const WEATHER_INTERVAL_MS = 30 * 60 * 1000;
const WEATHER_TIMEOUT_MS = 10 * 1000;
const MAX_LOCATIONS = 16;

function weatherLocation(value) {
  const lat = value?.lat, lng = value?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number'
    || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, key: `${lat.toFixed(6)},${lng.toFixed(6)}` };
}

function normalizeCurrent(payload) {
  const c = payload?.current;
  if (!c || !Number.isFinite(c.temperature_2m) || c.temperature_2m < -100 || c.temperature_2m > 70
    || !Number.isFinite(c.relative_humidity_2m) || c.relative_humidity_2m < 0 || c.relative_humidity_2m > 100
    || !Number.isInteger(c.weather_code)) return null;
  let windSpeed = Number.isFinite(c.wind_speed_10m) && c.wind_speed_10m >= 0 ? c.wind_speed_10m : null;
  const unit = payload.current_units?.wind_speed_10m;
  if (windSpeed !== null && unit === 'm/s') windSpeed *= 3.6;
  else if (windSpeed !== null && (unit === 'mp/h' || unit === 'mph')) windSpeed *= 1.609344;
  else if (unit && unit !== 'km/h') windSpeed = null;
  const condition = ['haze', 'dust', 'sleet', 'hail', 'thunderstorm'].includes(c.condition) ? c.condition : undefined;
  return { temperature: c.temperature_2m, humidity: c.relative_humidity_2m, code: c.weather_code,
    ...(condition ? { condition } : {}),
    windSpeed: Number.isFinite(windSpeed) && windSpeed >= 0 ? windSpeed : null };
}

// No polling timer: only an explicit visible-panel request can start I/O.
// Attempts (including failures) are throttled per location and across restarts.
function createSunWeatherService({ fetchImpl = globalThis.fetch, now = Date.now, readCache = () => ({}), saveCache = () => {} } = {}) {
  let stored;
  try { stored = readCache(); } catch {}
  const cache = new Map();
  for (const [key, row] of Object.entries(stored?.entries || {}).slice(-MAX_LOCATIONS)) {
    if (!row || !Number.isFinite(row.attemptedAt)) continue;
    const data = row.data;
    // Disk values must pass the same physical ranges and optional-field
    // checks as fresh responses; a damaged cache is not a successful reading.
    const normalized = data && normalizeCurrent({ current: { temperature_2m: data.temperature,
      relative_humidity_2m: data.humidity, weather_code: data.code, wind_speed_10m: data.windSpeed, condition: data.condition } });
    if (data && !normalized) continue;
    cache.set(key, { attemptedAt: row.attemptedAt, data: normalized
      ? { ...normalized, ...(Number.isFinite(data.updatedAt) ? { updatedAt: data.updatedAt } : {}) } : null });
  }
  const pending = new Map();
  function persist() {
    try { saveCache({ version: 1, entries: Object.fromEntries(cache) }); } catch { /* Offline weather never interrupts the workspace. */ }
  }
  async function get(value) {
    const location = weatherLocation(value);
    if (!location) return null;
    const { key } = location;
    if (pending.has(key)) return pending.get(key);
    const previous = cache.get(key);
    const time = now();
    if (previous && time >= previous.attemptedAt && time - previous.attemptedAt < WEATHER_INTERVAL_MS) return previous.data;
    const row = { attemptedAt: time, data: previous?.data || null };
    cache.delete(key); cache.set(key, row);
    while (cache.size > MAX_LOCATIONS) cache.delete(cache.keys().next().value);
    persist();
    const job = Promise.resolve().then(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
      try {
        // The renderer supplies coordinates only, never an arbitrary URL.
        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.search = new URLSearchParams({ latitude: String(location.lat), longitude: String(location.lng),
          current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
          timezone: 'auto', temperature_unit: 'celsius', wind_speed_unit: 'kmh', forecast_days: '1' }).toString();
        const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error' });
        if (!response.ok) {
          // Release the response stream/connection even when no error body
          // needs to be shown (429 / upstream outage remain silent).
          try { await response.body?.cancel(); } catch {}
          throw new Error('weather_unavailable');
        }
        const data = normalizeCurrent(JSON.parse((await readLimitedBody(response, 64 * 1024)).toString('utf8')));
        if (data) { row.data = { ...data, updatedAt: now() }; persist(); }
      } catch { /* Keep the previous successful reading, with no user-facing error. */ }
      finally { clearTimeout(timeout); pending.delete(key); }
      return row.data;
    });
    pending.set(key, job);
    return job;
  }
  return { get };
}

module.exports = { WEATHER_INTERVAL_MS, WEATHER_TIMEOUT_MS, weatherLocation, normalizeCurrent, createSunWeatherService };
