'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
const finalCss = fs.readFileSync(path.join(root, 'renderer/ai-usage-final.css'), 'utf8');
const almanac = fs.readFileSync(path.join(root, 'renderer/almanac-widget.js'), 'utf8');
const sun = fs.readFileSync(path.join(root, 'renderer/sun-widget.js'), 'utf8');
const ai = fs.readFileSync(path.join(root, 'renderer/ai-usage.js'), 'utf8');
const inbox = fs.readFileSync(path.join(root, 'renderer/task-inbox.js'), 'utf8');
const domain = require('../renderer/domain');

const modules = [
  ['.home-almanac', 'wide'],
  ['.home-almanac', 'tall'],
  ['.home-sun', 'wide'],
  ['.home-sun', 'tall'],
  ['.home-cursor', 'wide'],
  ['.home-cursor', 'tall'],
  ['.home-inbox', 'wide'],
  ['.home-inbox', 'tall'],
];

test('layout-variant CSS covers almanac/sun/ai/inbox wide and tall', () => {
  for (const [sel, variant] of modules) {
    const needle = `${sel}[data-layout-variant='${variant}']`;
    assert.ok(css.includes(needle), `missing ${needle}`);
  }
  assert.match(css, /almanac-bg-tall\.webp/);
  assert.ok(css.includes("grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr)"), 'inbox wide two-column copy');
  assert.ok(css.includes('.sun-stats') && /\[data-layout-variant='tall'\][\s\S]{0,400}\.sun-stats[\s\S]{0,80}margin-top:\s*auto/.test(css), 'sun tall stats stick to bottom');
  assert.ok(css.includes('repeat(var(--q-columns)'), 'ai usage columns follow --q-columns');
});

test('AI usage providers keep distinct ok ring brand colors', () => {
  const providers = ['cursor', 'codex', 'claude', 'grokbot', 'grok', 'copilot', 'antigravity', 'manus'];
  const colors = new Set();
  for (const id of providers) {
    const re = new RegExp(
      String.raw`\.ai-usage-provider\[data-provider='${id}'\]\s*\{[\s\S]*?--q-ok-a:\s*([^;]+);`,
    );
    const match = finalCss.match(re);
    assert.ok(match, `missing brand --q-ok-a for ${id}`);
    colors.add(match[1].trim().toLowerCase());
  }
  assert.equal(colors.size, providers.length, `ring brand colors must differ: ${[...colors]}`);
  assert.doesNotMatch(finalCss, /\.q-icon\[data-provider=[\s\S]*--q-ok-a/);
});

test('widgets observe data-layout-variant and adapt content', () => {
  assert.match(almanac, /contentProfile/);
  assert.match(almanac, /renderTall/);
  assert.ok(almanac.includes("data-layout-variant"), 'almanac observes layout-variant');
  assert.match(sun, /resolveSunContentSize/);
  assert.ok(sun.includes("layoutSize === 'tall'"), 'sun tall branch');
  assert.ok(sun.includes('data-layout-variant'), 'sun observes layout-variant');
  assert.match(ai, /layoutForVariant/);
  assert.match(ai, /renderedVariant/);
  assert.ok(ai.includes('data-layout-variant'), 'ai observes layout-variant');
  assert.ok(ai.includes('getComputedStyle(nodes[0])'), 'animateTone reads provider palette');
  assert.ok(inbox.includes('layoutVariant'), 'inbox tracks layout variant');
  assert.ok(inbox.includes("'wide', 'tall', 'full'"), 'inbox emits summary on stretched variants');
  assert.ok(inbox.includes('data-layout-variant'), 'inbox observes layout-variant');
});

test('wide/tall placements keep the four size footprints', () => {
  assert.equal(domain.layoutVariantForPlacement({ width: 6, height: 2 }), 'wide');
  assert.equal(domain.layoutVariantForPlacement({ width: 4, height: 4 }), 'tall');
  assert.equal(domain.layoutVariantForPlacement({ width: 8, height: 4 }), 'full');
  assert.equal(domain.layoutVariantForPlacement({ width: 2, height: 2 }), 'compact');
  assert.equal(domain.sizeNameFromPlacement({ width: 2, height: 1 }), 'mini');
  assert.equal(domain.sizeNameFromPlacement({ width: 2, height: 2 }), 'small');
  assert.equal(domain.sizeNameFromPlacement({ width: 4, height: 2 }), 'medium');
  assert.equal(domain.sizeNameFromPlacement({ width: 4, height: 4 }), 'large');
  assert.equal(domain.sizeNameFromPlacement({ width: 6, height: 2 }), null, 'stretched wide is not a fifth footprint');
});
