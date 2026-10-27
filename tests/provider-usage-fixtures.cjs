'use strict';

// Electron profiles must never borrow credentials from the user's real tools.
// Individual integration tests can still inject their own auth/fetch fixtures.
if (process.versions.electron && process.env.TODO_TEST_USER_DATA) {
  // Hosted macOS VMs intermittently lose their GPU/Viz process during captures.
  // This preload is test-only; packaged applications retain normal rendering.
  if (process.platform === 'darwin' && process.env.CI) process.once('loaded', () => {
    if (process.type === 'browser') require('electron').app.disableHardwareAcceleration();
  });
  const cursor = require('../cursor-usage');
  // Generic UI suites must never unlock the real Cursor Keychain. Credential
  // acceptance tests explicitly inject this reader with a synthetic database.
  module.exports.readCursorAuthToken = cursor.readAuthToken;
  cursor.readAuthToken = () => ({ ok: false, error: 'fixture_no_auth' });
  const cursorService = cursor.createCursorUsageService({ readAuth: cursor.readAuthToken });
  cursor.fetchCursorUsage = options => cursorService.getUsage(options);
  cursor.resetCursorUsage = () => cursorService.reset();
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
