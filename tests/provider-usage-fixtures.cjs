'use strict';

// Electron profiles must never borrow credentials from the user's real tools.
// Individual integration tests can still inject their own auth/fetch fixtures.
if (process.versions.electron && process.env.TODO_TEST_USER_DATA) {
  if (process.env.POME_TEST_WELCOME !== '1') {
    require('node:fs').writeFileSync(require('node:path').join(process.env.TODO_TEST_USER_DATA, '.ui-welcome-done'), 'existing test user');
  }
  const weather = require('../sunWeather'), createWeather = weather.createSunWeatherService;
  weather.createSunWeatherService = options => createWeather({ fetchImpl: async () => new Response(JSON.stringify({
    current: { temperature_2m: 10.7, relative_humidity_2m: 78, weather_code: 0, wind_speed_10m: 0 },
  })), ...options });
  for (const [file, factory] of [
    ['claude-usage', 'createClaudeUsageService'], ['copilot-usage', 'createCopilotUsageService'],
    ['grok-usage', 'createGrokUsageService'], ['antigravity-usage', 'createAntigravityUsageService'],
    ['grokbot-usage', 'createGrokbotUsageService'],
  ]) {
    const service = require(`../${file}`), create = service[factory];
    service[factory] = options => create({ readAuth: () => ({ ok: false, error: 'fixture_no_auth' }), ...options });
  }
}
