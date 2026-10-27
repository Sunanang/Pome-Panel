import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/i18n/languages.json'),'utf8'));
const localeDir=path.join(root,'src/i18n/locales');
const base=JSON.parse(fs.readFileSync(path.join(localeDir,'en-US.json'),'utf8'));
const keys=Object.keys(base).sort();
const tokens=value=>[...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(m=>m[1]).sort();
assert.equal(new Set(catalog.map(r=>r.id)).size,catalog.length,'Unique language IDs');
assert.deepEqual(fs.readdirSync(localeDir).filter(n=>n.endsWith('.json')).sort(),catalog.map(r=>r.id+'.json').sort());
const productIndex=process.argv.indexOf('--product-catalog');
if(productIndex!==-1){
  const source=JSON.parse(fs.readFileSync(process.argv[productIndex+1],'utf8'));
  assert.deepEqual(catalog,source,'Website catalog must match desktop supported languages exactly');
}
for(const {id} of catalog){
  const messages=JSON.parse(fs.readFileSync(path.join(localeDir,id+'.json'),'utf8'));
  assert.deepEqual(Object.keys(messages).sort(),keys,id+': complete key coverage');
  for(const key of keys){
    assert.equal(typeof messages[key],'string',id+': '+key);
    assert(messages[key].trim(),id+': nonempty '+key);
    assert.deepEqual(tokens(messages[key]),tokens(base[key]),id+': placeholders '+key);
  }
  for(const page of ['home','todo','notes'])assert(fs.existsSync(path.join(root,'public/assets/product',id,page+'.png')),id+': real '+page+' capture');
}
console.log(`${catalog.length} languages, ${keys.length} keys each, placeholders and ${catalog.length*3} product screenshots verified.`);
