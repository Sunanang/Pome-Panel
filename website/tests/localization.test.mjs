import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveLocale, normalizePreference, interpolate, readmeFilename } from '../src/i18n/core.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../src/i18n/languages.json',import.meta.url)));

test('explicit language overrides browser preferences',()=>{
  for(const {id} of catalog)assert.equal(resolveLocale(id,['zh-CN','en-US'],catalog),id);
});
test('Chinese script and region matching preserves traditional and simplified variants',()=>{
  for(const id of ['zh-TW','zh-HK','zh-MO','zh-Hant','zh-Hant-HK','zh_HK'])assert.equal(resolveLocale('system',[id],catalog),'zh-TW');
  for(const id of ['zh','zh-CN','zh-Hans','zh-Hans-SG','zh-SG'])assert.equal(resolveLocale('system',[id],catalog),'zh-CN');
});
test('browser regional variants map to supported product locales',()=>{
  const cases={'en-GB':'en-US','es-MX':'es-ES','fr-CA':'fr-FR','de-AT':'de-DE','pt-PT':'pt-BR','ru-BY':'ru-RU','ja':'ja-JP','ko':'ko-KR'};
  for(const [value,wanted] of Object.entries(cases))assert.equal(resolveLocale('system',[value],catalog),wanted);
});
test('the first supported browser preference wins, with English fallback',()=>{
  assert.equal(resolveLocale('system',['ar-EG','fr-CA','de-DE'],catalog),'fr-FR');
  assert.equal(resolveLocale('system',['ar-EG','tr-TR'],catalog),'en-US');
  assert.equal(resolveLocale('system',[],catalog),'en-US');
});
test('invalid persisted preferences cannot become asset paths',()=>{
  for(const bad of [null,undefined,'../zh-CN','__proto__','en','unsupported']){
    assert.equal(normalizePreference(bad,catalog),'system');
    assert.equal(resolveLocale(bad,['ru-RU'],catalog),'ru-RU');
  }
});
test('parameters are literal text and unknown tokens remain inspectable',()=>{
  assert.equal(interpolate('Real {page} screen',{page:'<img src=x>'}),'Real <img src=x> screen');
  assert.equal(interpolate('Real {page} screen'),'Real {page} screen');
});
test('documentation links preserve Chinese script and Brazilian Portuguese filenames',()=>{
  assert.equal(readmeFilename('zh-CN'),'README.md');
  assert.equal(readmeFilename('zh-TW'),'README.zh-TW.md');
  assert.equal(readmeFilename('pt-BR'),'README.pt-BR.md');
  assert.equal(readmeFilename('en-US'),'README.en.md');
  assert.equal(readmeFilename('ja-JP'),'README.ja.md');
});
