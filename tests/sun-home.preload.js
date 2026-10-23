const { contextBridge } = require('electron');
const platform = require('../platform');
const name = process.argv.find(arg => arg.startsWith('--sun-test-platform='))?.split('=')[1];
let collapse;
let toggle;
let reminderSchedules = 0;
contextBridge.exposeInMainWorld('notchAPI', {
  platform: name,
  capabilities: platform.resolveCapabilities(name),
  onCollapseRequest(callback) { collapse = callback; },
  onToggleShortcut(callback) { toggle = callback; },
  fixtureCollapse() { collapse?.(); },
  fixtureToggle() { toggle?.(); },
  async scheduleTodoReminders() { reminderSchedules += 1; },
  fixtureReminderScheduleCount() { return reminderSchedules; },
});
