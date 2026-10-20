'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { app } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA, restart = process.env.POME_PROVIDER_RESTART === '1';
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
process.env.POME_TEST_NOTIFICATIONS = '1';
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
const requests = [];
let copilotUnlimited = false;
for (const [file, factory, token] of [
  ['copilot-usage', 'createCopilotUsageService', 'fixture-copilot'],
  ['grok-usage', 'createGrokUsageService', 'fixture-grok'],
  ['antigravity-usage', 'createAntigravityUsageService', 'fixture-antigravity'],
  ['manus-usage', 'createManusUsageService', 'fixture-manus'],
  ['grokbot-usage', 'createGrokbotUsageService', 'fixture-cursor'],
]) {
  const module = require(`../${file}`), create = module[factory];
  module[factory] = options => create({ ...options, readAuth: () => ({ ok: false }), fetchImpl: async (url, options) => {
    assert((options.headers.Authorization || options.headers['x-manus-api-key']).endsWith(token)); requests.push(url);
    const data = file === 'grokbot-usage' ? require('./fixtures/ai-usage/grokbot-iso.json')
      : file === 'manus-usage' ? { ok: true, data: { total_credits: 60 } } : file === 'copilot-usage' ? {
        quota_reset_date_utc: '2026-11-01T00:00:00.000Z',
        quota_snapshots: {
          premium_interactions: copilotUnlimited ? { unlimited: true } : { remaining: 50, entitlement: 100, quota_reset_at: 0 },
          chat: { unlimited: true, remaining: 0, entitlement: 0, percent_remaining: 0 },
          completions: { unlimited: true, remaining: 0, entitlement: 0, percent_remaining: 0 },
        },
      }
      : file === 'grok-usage' ? { total: { val: '-1000' } }
        : url.endsWith('loadCodeAssist') ? { cloudaicompanionProject: 'project' }
          : { summary: { groups: [{ name: 'Gemini', buckets: [{ id: 'weekly', remaining: { case: 'remainingFraction', value: 0.5 } }] }] } };
    return new Response(JSON.stringify(data));
  } });
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let started = false;
const watchdog = setTimeout(() => { console.error('Provider credentials timed out'); app.exit(1); }, 60000);
app.on('web-contents-created', (_event, c) => c.once('did-finish-load', () => {
  if (started || !c.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(c).then(() => { clearTimeout(watchdog); console.log(`Provider credentials ${restart ? 'process restart' : 'save/UI'} checks passed`); app.exit(0); })
    .catch(error => { console.error(error); app.exit(1); });
}));
async function run(c) {
  const js = code => c.executeJavaScript(code);
  async function until(code) { for (let i=0;i<300;i++) { if (await js(code)) return; await delay(20); } throw new Error('Timed out: '+code); }
  await until('!!window.NotchAiSources?.getState().ready');
  if (!restart) {
    assert.equal((await js(`notchAPI.setCursorToken('fixture-cursor')`)).ok, true);
    assert.equal((await js(`notchAPI.setAiProviderToken('grok','fixture-grok')`)).error, 'grok_team_required');
    assert.equal((await js(`notchAPI.getAiProviderTokenStatus('grok')`)).configured, false);
    assert.equal((await js(`notchAPI.setAiProviderToken('copilot','fixture-copilot')`)).ok, true);
    assert.equal((await js(`notchAPI.setAiProviderToken('antigravity','fixture-antigravity')`)).ok, true);
    assert.equal((await js(`notchAPI.setAiProviderToken('manus','fixture-manus')`)).ok, true);
    await js(`setMode(true);setActiveTab('settings')`);
    await js(`PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));document.getElementById('settings-grok-token').value='fixture-grok';document.getElementById('settings-grok-team').value='team-b';document.getElementById('settings-grok-team').dispatchEvent(new Event('input'));`);
    await js(`notchAPI.setLanguage('en-US')`);
    await until(`document.documentElement.lang==='en-US'`);
    const translated = await js(`({save:document.querySelector('[data-provider-save="grok"]').textContent,placeholder:document.getElementById('settings-grok-token').placeholder,token:document.getElementById('settings-grok-token').value,team:document.getElementById('settings-grok-team').value})`);
    assert.equal(translated.save,'Save'); assert.equal(translated.placeholder,'Paste Grok token');
    assert.equal(translated.token,'fixture-grok'); assert.equal(translated.team,'team-b');
    await js(`document.querySelector('[data-provider-save="grok"]').click()`);
    await until(`!document.querySelector('[data-provider-save="grok"]').disabled && document.getElementById('settings-grok-token').value===''`);
    assert.equal((await js(`notchAPI.getAiProviderTokenStatus('grok')`)).teamId, 'team-b');
    // An unrelated settings write must preserve all encrypted provider tokens.
    assert.equal((await js(`notchAPI.setLanguage('zh-CN')`)).ok, true);
  }
  for (const id of ['copilot','grok','antigravity','manus']) assert.equal((await js(`notchAPI.getAiProviderTokenStatus('${id}')`)).configured, true);
  assert.equal((await js(`notchAPI.getAiProviderTokenStatus('grok')`)).teamId, 'team-b');
  const settings = await js('notchAPI.getAppSettings()');
  assert.equal(Object.hasOwn(settings,'encryptedProviderTokens'), false);
  const stored = fs.readFileSync(path.join(profile,'app-settings.json'),'utf8');
  for (const id of ['copilot','grok','antigravity','manus']) { assert(JSON.parse(stored).encryptedProviderTokens[id]); assert(!stored.includes(`fixture-${id}`)); }
  for (const method of ['getCopilotUsage','getGrokUsage','getAntigravityUsage','getManusUsage']) assert.equal((await js(`notchAPI.${method}({force:true})`)).ok, true);
  assert(requests.some(url => url.includes('/teams/team-b/prepaid/balance')));
  assert.equal((await js('notchAPI.getManusUsage()')).credits.available,60);
  const sand = await js('notchAPI.getGrokbotUsage({force:true})');
  assert.equal(sand.primary.resetsAt, Date.parse('2026-09-14T04:00:16.825Z')/1000);
  await js('NotchAiUsage.refresh({force:true})');
  await js(`document.getElementById('home-cursor').dataset.widgetSize='large'`);
  assert.match(await js(`document.querySelector('#grok-usage-rows strong').textContent`),/10\.00/);
  assert.equal(await js(`document.querySelector('#grok-usage-rows .cursor-usage-track').hidden`),true);
  assert.equal(await js(`document.querySelectorAll('#copilot-usage-rows .ai-quota-row').length`),1);
  assert.equal(await js(`document.querySelector('#copilot-usage-rows strong').textContent`),'50%');
  assert.equal(await js(`document.getElementById('ai-provider-copilot').dataset.level`),'ok');
  assert.equal(await js(`document.querySelector('#antigravity-usage-rows strong').textContent`),'50%');
  assert.equal(await js(`document.querySelector('#grokbot-usage-rows .ai-quota-help').textContent.includes(PomeI18n.t('copy.resetTimeUnknown.2446e1'))`),false);
  assert.equal(await js(`document.querySelector('#home-cursor [role=tab]')`),null);
  assert.equal(await js(`document.querySelector('#manus-usage-rows strong').textContent`),'60');
  assert.equal(await js(`document.querySelector('#manus-usage-rows .cursor-usage-track').hidden`),true);
  assert(!await js(`JSON.stringify(collectLocalStorageSnapshot()).includes('fixture-grok')`));
  copilotUnlimited = true;
  await js('NotchAiUsage.refresh({force:true})');
  await until(`document.querySelector('#copilot-usage-rows strong').textContent===PomeI18n.t('copy.unlimited.8651f5')`);
  assert.equal(await js(`document.querySelector('#copilot-usage-rows .cursor-usage-track').hidden`),true);
  assert.equal(await js(`document.getElementById('ai-provider-copilot').dataset.level`),'ok');
  if (!restart) {
    // Merged rows retain every generic provider's actual save/clear UI handlers.
    for (const id of ['copilot','grok','antigravity','manus']) {
      await js(`document.querySelector('[data-provider-clear="${id}"]').click()`);
      await until(`!document.querySelector('[data-provider-clear="${id}"]').disabled`);
      assert.equal((await js(`notchAPI.getAiProviderTokenStatus('${id}')`)).configured,false);
      assert.equal(await js(`document.getElementById('settings-${id}-token').value`),'');
      await js(`document.getElementById('settings-${id}-token').value='fixture-${id}'`);
      if (id === 'grok') await js(`document.getElementById('settings-grok-team').value='team-b';document.getElementById('settings-grok-team').dispatchEvent(new Event('input'))`);
      await js(`document.querySelector('[data-provider-save="${id}"]').click()`);
      await until(`!document.querySelector('[data-provider-save="${id}"]').disabled && document.getElementById('settings-${id}-token').value===''`);
      assert.equal((await js(`notchAPI.getAiProviderTokenStatus('${id}')`)).configured,true);
    }
  }
  if (restart) {
    assert.equal((await js(`notchAPI.clearAiProviderToken('grok')`)).ok,true);
    assert.equal((await js(`notchAPI.getAiProviderTokenStatus('grok')`)).configured,false);
    assert.equal((await js(`notchAPI.getAiProviderTokenStatus('grok')`)).teamId,'');
    assert.equal((await js(`notchAPI.getAiProviderTokenStatus('copilot')`)).configured,true);
  }
}
require('../main');
