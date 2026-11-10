(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PomeWeather = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Wind thresholds use km/h. Rain keeps its WMO label when wind is overlaid.
  const WIND_KMH = 25, STRONG_WIND_KMH = 40;
  const states = {
    0: ['clear', 'sun', 'none'], 1: ['mostlyClear', 'mostly', 'none'],
    2: ['cloudy', 'cloud', 'none'], 3: ['overcast', 'overcast', 'none'],
    45: ['fog', 'fog', 'fog'], 48: ['rimeFog', 'fog', 'fog'],
    51: ['drizzle', 'drizzle', 'drizzle'], 53: ['drizzle', 'drizzle', 'drizzle'], 55: ['drizzle', 'drizzle', 'drizzle'],
    56: ['freezingDrizzle', 'drizzle', 'drizzle'], 57: ['freezingDrizzle', 'drizzle', 'drizzle'],
    61: ['lightRain', 'rain', 'rain-light'], 63: ['rain', 'rain', 'rain-mid'], 65: ['heavyRain', 'rain', 'rain-heavy'],
    66: ['freezingRain', 'rain', 'rain-mid'], 67: ['freezingRain', 'rain', 'rain-mid'],
    71: ['lightSnow', 'snow', 'snow-light'], 73: ['snow', 'snow', 'snow-mid'], 75: ['heavySnow', 'snow', 'snow-heavy'],
    77: ['snowGrains', 'snow', 'snow-light'], 80: ['showers', 'rain', 'rain-mid'], 81: ['showers', 'rain', 'rain-mid'],
    82: ['heavyShowers', 'rain', 'rain-heavy'], 85: ['snowShowers', 'snow', 'snow-mid'], 86: ['snowShowers', 'snow', 'snow-heavy'],
    95: ['thunder', 'thunder', 'thunder'], 96: ['thunderHail', 'hail', 'hail'], 99: ['thunderHail', 'hail', 'hail'],
  };
  // These independent product fallback states require an explicit condition
  // from a source that actually provides it. Open-Meteo current has no haze,
  // dust or sleet code; never invent them from temperature/humidity alone.
  const fallback = { haze: ['haze', 'haze', 'haze'], dust: ['dust', 'dust', 'dust'],
    sleet: ['sleet', 'sleet', 'sleet'], hail: ['hail', 'hail', 'hail'], thunderstorm: ['thunderstorm', 'thunder', 'thunder'] };
  function classify(data) {
    let state = (Object.hasOwn(fallback, data?.condition) ? fallback[data.condition] : null)
      || (Object.hasOwn(states, data?.code) ? states[data.code] : null);
    if (!state || !Number.isFinite(data?.temperature)) return { name: 'unknown', icon: 'empty', family: 'none', available: false };
    let [name, icon, family] = state;
    if (Number.isFinite(data.windSpeed) && data.windSpeed >= WIND_KMH) {
      if (family.startsWith('rain-')) family = 'rain-wind';
      else if (family === 'none') {
        name = data.windSpeed >= STRONG_WIND_KMH ? 'strongWind' : 'wind';
        icon = 'wind'; family = data.windSpeed >= STRONG_WIND_KMH ? 'wind-strong' : 'wind';
      }
    }
    return { name, icon, family, available: true };
  }
  function view(data, size, t, unit) {
    const state = classify(data);
    const compact = size === 'mini' || size === 'small';
    const label = t(`weather.${state.name}`);
    const reading = unit === 'f' ? data?.temperature * 9 / 5 + 32 : data?.temperature;
    const suffix = unit === 'f' ? '°F' : unit === 'c' ? '°C' : '°';
    const temperature = state.available ? `${compact ? Math.round(reading) : Math.round(reading * 10) / 10}${suffix}` : `--${suffix}`;
    const humidity = size === 'large' && state.available && Number.isFinite(data.humidity)
      ? ` · ${t('weather.humidity', { value: Math.round(data.humidity) })}` : '';
    const title = `${label} · ${temperature}${humidity}`;
    const shortName = t(`weather.compact.${state.name}`);
    return { ...state, title, label: size === 'small' ? shortName : label, temperature, humidity,
      text: size === 'mini' ? temperature : `${size === 'small' ? shortName : label} · ${temperature}${humidity}`,
      showIcon: size !== 'small' || [...shortName].length < 4 };
  }
  return { WIND_KMH, STRONG_WIND_KMH, classify, view };
});
