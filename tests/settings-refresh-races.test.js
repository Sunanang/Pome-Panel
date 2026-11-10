'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../renderer/workspace.js'),'utf8');
function harness(){
 const pending=[];let changed;
 const c={settingsAppSettings:{taskNotifications:true},settingsAppSettingsRevision:0,settingsRefreshGeneration:0,settingsWorkspace:null,transcriptionConfig:null,settingsCursorTokenMeta:null,
  window:{notchAPI:{getAppSettings:()=>new Promise(resolve=>pending.push(resolve)),onAppSettingsChanged:fn=>{changed=fn}}},
  updateTranscriptionConfigUi(){},updateRecordingUi(){},renderCodexSettings(){},applySettingsMirrorCover(){},renderSettingsPanel(){}};
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('  async function refreshSettingsPanel()'),source.indexOf('  async function loadTranscriptionConfig()')),c);
 vm.runInContext(source.slice(source.indexOf('  window.notchAPI?.onAppSettingsChanged?.('),source.indexOf('  window.notchAPI?.onWorkspaceChanged?.(')),c);
 return {c,pending,changed:value=>changed(value)};
}
test('a settings broadcast supersedes an older pending settings read',async()=>{
 const h=harness(),job=h.c.refreshSettingsPanel();h.changed({taskNotifications:false});h.pending[0]({taskNotifications:true});await job;assert.equal(h.c.settingsAppSettings.taskNotifications,false);
});
test('a late older refresh cannot overwrite the newest completed refresh',async()=>{
 const h=harness(),old=h.c.refreshSettingsPanel(),fresh=h.c.refreshSettingsPanel();h.pending[1]({taskNotifications:false});await fresh;h.pending[0]({taskNotifications:true});await old;assert.equal(h.c.settingsAppSettings.taskNotifications,false);
});
test('an uncontested settings read still updates the settings view',async()=>{
 const h=harness(),job=h.c.refreshSettingsPanel();h.pending[0]({taskNotifications:false});await job;assert.equal(h.c.settingsAppSettings.taskNotifications,false);
});
