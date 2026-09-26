const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
// The production bootstrap may inspect encrypted legacy settings on this Mac.
// Use Chromium's test keychain so a regression test never prompts for user keys.
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({version:1, localStorage:{
  'notch-home-note':'Recovered workspace note',
  'notch-recordings':JSON.stringify([{id:'startup-recording',createdAt:1788709776699,durationMs:1558,transcript:'',audioPath:'recordings/retained.webm',mimeType:'audio/webm',title:'Saved recording',category:'未分类'}]),
}}));
const errors = [];
const EXPECTED = {home:true,workspace:true,note:'Recovered workspace note',recordings:1};
const READ_STATE = `({home:!!window.NotchHome,workspace:!!window.NotchWorkspace,note:document.getElementById('home-note')?.value ?? null,recordings:document.querySelectorAll('.recording-item').length})`;
const deadline = Date.now() + 20000;
const watchdog = setTimeout(() => { console.error('Production startup timed out', errors); app.exit(1); process.exit(1); }, 25000);
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  contents.once('did-finish-load', () => {
    if (!contents.getURL().endsWith('/renderer/index.html')) return;
    waitForRecovery(contents);
  });
});
// hydratePortableWorkspace() reloads the page after importing workspace.json,
// so poll for the recovered state instead of sampling one moment after first load.
async function waitForRecovery(contents) {
  let state = null;
  while (Date.now() < deadline) {
    try {
      if (!contents.isDestroyed()) state = await contents.executeJavaScript(READ_STATE);
      if (state && state.note === EXPECTED.note && state.recordings === EXPECTED.recordings) break;
    } catch (error) { state = {error: String((error && error.message) || error)}; }
    await new Promise((resolve) => { setTimeout(resolve, 250); });
  }
  clearTimeout(watchdog);
  try {
    assert.deepEqual(errors, []);
    assert.deepEqual(state, EXPECTED);
    console.log('Production workspace recovery checks passed');
    app.quit();
    setTimeout(() => process.exit(0), 3000).unref();
  } catch (error) { console.error(error); app.exit(1); process.exit(1); }
}
require('../main.js');
